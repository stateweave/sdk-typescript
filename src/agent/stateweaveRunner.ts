import { applyOps, addToolResult } from "../core/applyOps.js";
import { appendInputToGraphFrame, cloneFrame, createInitialGraphFrame, nowIso } from "../core/graph.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import { serializeGraphFrame } from "../core/serialize.js";
import type { AgentResult, GraphEdge, GraphFrame, GraphNode, GraphOp, StateWeaveRunMetadata, StateWeaveStreamEvent, TraceStep, WorkerRunSummary } from "../core/types.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";

export type StateWeaveInput = TaskInput;
export type StateWeaveRunOptions = { frame?: GraphFrame; inputAlreadyAppended?: boolean };
export type StateWeaveRunnerArgs = { model: Model; tools: Tool[]; maxIterations?: number; systemPrompt?: string; nodeTypes?: string[] };

export class StateWeaveRunError extends Error {
  trace: TraceStep[];
  metadata: StateWeaveRunMetadata;

  constructor(message: string, trace: TraceStep[], metadata: StateWeaveRunMetadata) {
    super(message);
    this.name = "StateWeaveRunError";
    this.trace = trace;
    this.metadata = metadata;
  }
}

export async function runStateWeave(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
  let result: AgentResult | undefined;
  for await (const event of streamStateWeave(args, input, options)) {
    if (event.type === "final") result = event.result;
  }
  if (!result) throw new Error("StateWeave stream ended without a final result.");
  return result;
}

export async function* streamStateWeave(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
  const tools = new Map(args.tools.map((tool) => [tool.name, tool]));
  const task = normalizeTaskInput(input);
  let frame = options?.frame
    ? options.inputAlreadyAppended
      ? cloneFrame(options.frame)
      : appendInputToGraphFrame(options.frame, task)
    : createInitialGraphFrame({
        objective: task.objective,
        input: task.input,
        systemPrompt: args.systemPrompt,
        availableActions: [...tools.values()].map((tool) => `tool:${tool.name} - ${tool.description}`),
        nodeTypes: args.nodeTypes
      });
  const trace: TraceStep[] = [];
  const maxIterations = args.maxIterations ?? 30;
  const runId = runIdForNow();
  const startedAt = new Date();
  let retryCount = 0;
  let finalAnswer = "";
  const toolInfo = [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description }));

  yield { type: "metadata", metadata: runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "running") };

  for (let step = 1; step <= maxIterations; step++) {
    const stepStartedAt = new Date();
    const frameBefore = cloneFrame(frame);
    const prompt = serializeGraphFrame(frameBefore);
    const streamedTokens: string[] = [];
    const modelMetadata: Record<string, unknown>[] = [];

    yield { type: "frame", step, phase: "before", frame: frameBefore, prompt, tokenEstimate: estimateStateWeaveTokens(prompt) };
    for await (const event of args.model.stream({ prompt, frame: frameBefore, mode: "graph_ops" })) {
      if (event.type === "metadata") {
        modelMetadata.push(event.metadata);
        yield { type: "model_metadata", step, metadata: event.metadata };
        continue;
      }
      streamedTokens.push(event.token);
      yield { type: "token", step, token: event.token };
    }

    const rawModelOutput = streamedTokens.join("");
    let parsedOps: GraphOp[] = [];
    try {
      parsedOps = parseAndValidateOps(rawModelOutput);
      if (hasWorkers(parsedOps) && parsedOps.some((op) => op.op === "final")) throw new Error("GraphOps cannot include @worker and @final in the same transaction; spawn workers first, then synthesize a final answer after worker results merge.");
      validateObservationToolTransaction(parsedOps);
      frame = applyOps(frame, parsedOps);
      yield { type: "ops", step, ops: parsedOps };
      frame = await runToolOps(frame, parsedOps, tools, step);
      if (hasWorkers(parsedOps)) {
        const scheduler = scheduleWorkers(frame, parsedOps, args, step, maxIterations);
        frame = scheduler.frame;
        for await (const event of scheduler.events) yield event;
        frame = mergeWorkerExecutions(frame, await scheduler.done);
        yield { type: "worker", step, phase: "merged", worker: mergedWorkersSummary(parsedOps), frame: cloneFrame(frame) };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const frameAfter = cloneFrame(frame);
      trace.push(traceStep({ step, startedAt: stepStartedAt, frameBefore, prompt, streamedTokens, modelMetadata, rawModelOutput, parsedOps, frameAfter, error: message }));
      const retryable = step < maxIterations;
      yield { type: "error", step, message, retryable };
      if (!retryable) throw new StateWeaveRunError(`StateWeave GraphOps failed after ${step} step(s): ${message}`, trace, runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "error"));
      retryCount += 1;
      frame = retryFrameAfterGraphOpsError(frame, message);
      continue;
    }

    const final = parsedOps.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
    if (final) finalAnswer = final.answer;

    const frameAfter = cloneFrame(frame);
    trace.push(traceStep({ step, startedAt: stepStartedAt, frameBefore, prompt, streamedTokens, modelMetadata, rawModelOutput, parsedOps, frameAfter }));
    yield { type: "frame", step, phase: "after", frame: frameAfter };
    if (finalAnswer) break;
  }

  if (!finalAnswer) {
    throw new StateWeaveRunError(
      `Recursion limit reached after ${maxIterations} iteration(s); consider increasing maxIterations.`,
      trace,
      runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "error")
    );
  }
  yield { type: "final", result: { finalAnswer, frame, graph: frame.graph, trace, metadata: runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "done") } };
}

function traceStep(args: {
  step: number;
  startedAt: Date;
  frameBefore: GraphFrame;
  prompt: string;
  streamedTokens: string[];
  modelMetadata: Record<string, unknown>[];
  rawModelOutput: string;
  parsedOps: GraphOp[];
  frameAfter: GraphFrame;
  error?: string;
}): TraceStep {
  const completedAt = new Date();
  return {
    step: args.step,
    startedAt: args.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - args.startedAt.getTime(),
    frameBefore: args.frameBefore,
    prompt: args.prompt,
    tokenEstimate: estimateStateWeaveTokens(args.prompt),
    streamedTokens: args.streamedTokens,
    ...(args.modelMetadata.length ? { modelMetadata: args.modelMetadata } : {}),
    rawModelOutput: args.rawModelOutput,
    parsedOps: args.parsedOps,
    frameAfter: args.frameAfter,
    ...(args.error ? { error: args.error } : {})
  };
}

function runMetadata(
  runId: string,
  tools: StateWeaveRunMetadata["tools"],
  startedAt: Date,
  maxIterations: number,
  trace: TraceStep[],
  retryCount: number,
  status: StateWeaveRunMetadata["status"]
): StateWeaveRunMetadata {
  const completedAt = status === "running" ? undefined : new Date();
  return {
    runId,
    tools,
    startedAt: startedAt.toISOString(),
    ...(completedAt ? { completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - startedAt.getTime() } : {}),
    maxIterations,
    stepCount: trace.length,
    retryCount,
    status
  };
}

function runIdForNow(): string {
  return `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function retryFrameAfterGraphOpsError(frame: GraphFrame, message: string): GraphFrame {
  const next = cloneFrame(frame);
  const latest = next.frame.latestInputNodeId ?? next.frame.activeUserInputNodeId ?? "the latest user_input";
  next.frame.lastGraphOpsError = message;
  next.frame.currentFocus = `Previous GraphOps transaction was rejected: ${message}`;
  next.frame.nextExpectedOutput = `Retry the complete SWX/1 transaction. First attach ${latest} to system_root for a fresh request or to the relevant existing node, then attach every new semantic/output node with @edge before returning @final "human-readable answer" or @final_ref final_answer.`;
  return next;
}

async function runToolOps(frame: GraphFrame, ops: GraphOp[], tools: Map<string, Tool>, step: number): Promise<GraphFrame> {
  let next = frame;
  for (const op of ops) {
    if (op.op !== "call_tool") continue;
    const tool = tools.get(op.tool);
    if (!tool) throw new Error(`Unknown tool: ${op.tool}`);
    const parsedArgs = tool.schema.parse(op.args);
    const result = await tool.execute(parsedArgs);
    next = { ...next, graph: addToolResult(next.graph, { tool: op.tool, result, step }) };
    next.frame.currentFocus = `Use ${op.tool} result to decide the next graph mutation or final answer.`;
  }
  return next;
}

type WorkerPlan = {
  id: string;
  taskNodeId: string;
  resultNodeId: string;
  objective: string;
  input?: string;
  focusNodeId?: string;
  maxIterations?: number;
};

type WorkerExecution = { plan: WorkerPlan; baseFrame: GraphFrame; result?: AgentResult; error?: string };

function hasWorkers(ops: GraphOp[]): boolean {
  return ops.some((op) => op.op === "spawn_worker");
}

function validateObservationToolTransaction(ops: GraphOp[]): void {
  const observationCalls = ops.filter((op): op is Extract<GraphOp, { op: "call_tool" }> => op.op === "call_tool" && (op.tool === "read_file" || op.tool === "bash_command"));
  if (!observationCalls.length) return;
  const otherToolCalls = ops.filter((op) => op.op === "call_tool").length - observationCalls.length;
  if (ops.some((op) => op.op === "final") || otherToolCalls > 0 || observationCalls.length > 1) {
    throw new Error("read_file and bash_command are observation steps: call exactly one in a transaction without other tools or @final, then use its tool_result in the next iteration.");
  }
}

function workerOps(ops: GraphOp[]): Extract<GraphOp, { op: "spawn_worker" }>[] {
  return ops.filter((op): op is Extract<GraphOp, { op: "spawn_worker" }> => op.op === "spawn_worker");
}

function scheduleWorkers(
  frame: GraphFrame,
  ops: GraphOp[],
  args: StateWeaveRunnerArgs,
  step: number,
  parentMaxIterations: number
): { frame: GraphFrame; events: AsyncIterable<StateWeaveStreamEvent>; done: Promise<WorkerExecution[]> } {
  const { frame: preparedFrame, plans } = prepareWorkerPlans(frame, workerOps(ops));
  const queue = new AsyncEventQueue<StateWeaveStreamEvent>();
  const executions = Promise.all(plans.map((plan) => runWorker(plan, preparedFrame, args, step, parentMaxIterations, queue))).finally(() => queue.close());
  return { frame: preparedFrame, events: queue, done: executions };
}

function prepareWorkerPlans(frame: GraphFrame, ops: Extract<GraphOp, { op: "spawn_worker" }>[]): { frame: GraphFrame; plans: WorkerPlan[] } {
  const next = cloneFrame(frame);
  const plans: WorkerPlan[] = [];

  for (const op of ops) {
    const safeId = safeWorkerId(op.id);
    const taskNodeId = uniqueNodeId(next.graph, `worker_task_${safeId}`);
    const resultNodeId = uniqueNodeId(next.graph, `worker_result_${safeId}`);
    const focusNodeId = op.focusNodeId && hasNode(next.graph, op.focusNodeId)
      ? op.focusNodeId
      : next.frame.focusNodeId && hasNode(next.graph, next.frame.focusNodeId)
        ? next.frame.focusNodeId
        : next.frame.activeUserInputNodeId && hasNode(next.graph, next.frame.activeUserInputNodeId)
          ? next.frame.activeUserInputNodeId
          : "system_root";
    const createdAt = nowIso();
    next.graph.nodes.push({
      id: taskNodeId,
      type: "worker_task",
      text: op.objective,
      data: withoutUndefined({ workerId: op.id, focusNodeId, input: op.input, status: "queued" }),
      status: "active",
      confidence: 1,
      createdAt
    });
    if (hasNode(next.graph, focusNodeId)) addGraphEdge(next.graph, focusNodeId, taskNodeId, "relates_to");
    plans.push({ id: op.id, taskNodeId, resultNodeId, objective: op.objective, input: op.input, focusNodeId, maxIterations: op.maxIterations });
  }

  next.frame.currentFocus = `Scheduler queued ${plans.length} graph worker${plans.length === 1 ? "" : "s"}; wait for worker_result nodes, then synthesize a concise final answer.`;
  next.frame.nextExpectedOutput = "After workers merge, read worker_result nodes and relevant graph artifacts, then return one human-readable final answer with artifact refs when useful.";
  next.frame.candidateFocusNodeIds = unique([...plans.map((plan) => plan.taskNodeId), ...(next.frame.candidateFocusNodeIds ?? [])]);
  return { frame: next, plans };
}

async function runWorker(
  plan: WorkerPlan,
  baseFrame: GraphFrame,
  args: StateWeaveRunnerArgs,
  parentStep: number,
  parentMaxIterations: number,
  queue: AsyncEventQueue<StateWeaveStreamEvent>
): Promise<WorkerExecution> {
  const workerFrame = workerFrameFor(baseFrame, plan);
  const summary = workerSummary(plan, "queued");
  queue.push({ type: "worker", step: parentStep, phase: "queued", worker: summary });
  queue.push({ type: "worker", step: parentStep, phase: "started", worker: workerSummary(plan, "running") });

  let result: AgentResult | undefined;
  try {
    for await (const event of streamStateWeave(
      { ...args, maxIterations: plan.maxIterations ?? parentMaxIterations },
      { objective: plan.objective, input: plan.input ?? plan.objective },
      { frame: workerFrame, inputAlreadyAppended: true }
    )) {
      if (event.type === "token") queue.push({ type: "worker", step: parentStep, phase: "token", worker: workerSummary(plan, "running"), token: event.token });
      else if (event.type === "ops") queue.push({ type: "worker", step: parentStep, phase: "ops", worker: workerSummary(plan, "running"), ops: event.ops });
      else if (event.type === "error") queue.push({ type: "worker", step: parentStep, phase: event.retryable ? "retrying" : "error", worker: workerSummary(plan, event.retryable ? "retrying" : "error", { error: event.message }) });
      else if (event.type === "frame" && event.phase === "after") queue.push({ type: "worker", step: parentStep, phase: "ops", worker: workerSummary(plan, "running", { nodeCount: event.frame.graph.nodes.length, edgeCount: event.frame.graph.edges.length }) });
      else if (event.type === "final") result = event.result;
    }
    if (!result) throw new Error("Worker stream ended without a final result.");
    queue.push({ type: "worker", step: parentStep, phase: "done", worker: workerSummary(plan, "done", { finalAnswer: result.finalAnswer, nodeCount: result.graph.nodes.length, edgeCount: result.graph.edges.length }) });
    return { plan, baseFrame: workerFrame, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queue.push({ type: "worker", step: parentStep, phase: "error", worker: workerSummary(plan, "error", { error: message }) });
    return { plan, baseFrame: workerFrame, error: message };
  }
}

function workerFrameFor(baseFrame: GraphFrame, plan: WorkerPlan): GraphFrame {
  const frame = cloneFrame(baseFrame);
  frame.frame.objective = plan.objective;
  frame.frame.currentFocus = `Graph worker ${plan.id}: ${plan.objective}. Create or update nodes connected to ${plan.taskNodeId}; return a compact final summary.`;
  frame.frame.focusNodeId = plan.taskNodeId;
  frame.frame.latestInputNodeId = undefined;
  frame.frame.activeUserInputNodeId = undefined;
  frame.frame.candidateFocusNodeIds = unique([plan.taskNodeId, ...(plan.focusNodeId ? [plan.focusNodeId] : []), "system_root"]);
  frame.frame.nextExpectedOutput = `Complete worker objective "${plan.objective}" with GraphOps connected to ${plan.taskNodeId}, then return @final or @final_ref with a concise worker result.`;
  return frame;
}

function mergeWorkerExecutions(frame: GraphFrame, executions: WorkerExecution[]): GraphFrame {
  let next = cloneFrame(frame);
  const resultFocusIds: string[] = [];

  for (const execution of executions) {
    const task = next.graph.nodes.find((node) => node.id === execution.plan.taskNodeId);
    if (task) {
      task.status = execution.result ? "resolved" : "rejected";
      task.data = { ...task.data, status: execution.result ? "done" : "error", ...(execution.error ? { error: execution.error } : {}) };
    }

    if (execution.result) next = mergeWorkerGraph(next, execution.result.frame, execution.baseFrame);
    const resultNode = addWorkerResultNode(next.graph, execution);
    resultFocusIds.push(resultNode.id);
    addGraphEdge(next.graph, execution.plan.taskNodeId, resultNode.id, execution.result ? "validates" : "contradicts");
  }

  const done = executions.filter((item) => item.result).length;
  const failed = executions.length - done;
  next.frame.currentFocus = `Scheduler merged ${done} worker${done === 1 ? "" : "s"}${failed ? ` and ${failed} failure${failed === 1 ? "" : "s"}` : ""}. Synthesize the worker_result nodes into one final answer.`;
  next.frame.nextExpectedOutput = "Return exactly one human-readable @final or @final_ref that summarizes worker outcomes. Reference artifacts/nodes separately; do not paste every worker transcript.";
  next.frame.focusNodeId = resultFocusIds[0] ?? next.frame.focusNodeId;
  next.frame.candidateFocusNodeIds = unique([...resultFocusIds, ...(next.frame.candidateFocusNodeIds ?? [])]);
  return next;
}

function mergeWorkerGraph(currentFrame: GraphFrame, resultFrame: GraphFrame, baseFrame: GraphFrame): GraphFrame {
  const next = cloneFrame(currentFrame);
  const baseNodeIds = new Set(baseFrame.graph.nodes.map((node) => node.id));
  const baseEdgeKeys = new Set(baseFrame.graph.edges.map(edgeKey));
  const renames = new Map<string, string>();
  const newNodes = resultFrame.graph.nodes.filter((node) => !baseNodeIds.has(node.id));

  for (const node of newNodes) {
    if (next.graph.nodes.some((item) => item.id === node.id)) renames.set(node.id, uniqueNodeId(next.graph, node.id));
  }
  for (const node of newNodes) {
    const id = renames.get(node.id) ?? node.id;
    if (!next.graph.nodes.some((item) => item.id === id)) next.graph.nodes.push(rewriteNode(node, id, renames));
  }
  for (const edge of resultFrame.graph.edges) {
    if (baseEdgeKeys.has(edgeKey(edge))) continue;
    const rewritten = rewriteEdge(edge, renames);
    if (!hasNode(next.graph, rewritten.from) || !hasNode(next.graph, rewritten.to)) continue;
    if (!next.graph.edges.some((item) => edgeKey(item) === edgeKey(rewritten))) next.graph.edges.push({ ...rewritten, id: uniqueEdgeId(next.graph, rewritten) });
  }
  return next;
}

function addWorkerResultNode(graph: GraphFrame["graph"], execution: WorkerExecution): GraphNode {
  const node: GraphNode = {
    id: uniqueNodeId(graph, execution.plan.resultNodeId),
    type: "worker_result",
    text: execution.result?.finalAnswer ?? `Worker ${execution.plan.id} failed: ${execution.error ?? "unknown error"}`,
    data: withoutUndefined({
      workerId: execution.plan.id,
      objective: execution.plan.objective,
      focusNodeId: execution.plan.focusNodeId,
      status: execution.result ? "done" : "error",
      finalAnswer: execution.result?.finalAnswer,
      error: execution.error,
      nodeCount: execution.result?.graph.nodes.length,
      edgeCount: execution.result?.graph.edges.length
    }),
    status: execution.result ? "resolved" : "rejected",
    confidence: execution.result ? 1 : 0,
    createdAt: nowIso()
  };
  graph.nodes.push(node);
  return node;
}

function mergedWorkersSummary(ops: GraphOp[]): WorkerRunSummary {
  const count = workerOps(ops).length;
  return { id: "scheduler", objective: `Merged ${count} worker${count === 1 ? "" : "s"}`, status: "merged" };
}

function workerSummary(plan: WorkerPlan, status: WorkerRunSummary["status"], extra: Partial<WorkerRunSummary> = {}): WorkerRunSummary {
  return withoutUndefined({ id: plan.id, objective: plan.objective, focusNodeId: plan.focusNodeId, status, ...extra });
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(value: T): void {
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const resolver of this.resolvers.splice(0)) resolver({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.resolvers.push(resolve));
      }
    };
  }
}

function addGraphEdge(graph: GraphFrame["graph"], from: string, to: string, type: GraphEdge["type"]): void {
  if (graph.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type)) return;
  graph.edges.push({ id: uniqueEdgeId(graph, { from, to, type }), from, to, type, createdAt: nowIso() });
}

function uniqueNodeId(graph: GraphFrame["graph"], preferred: string): string {
  if (!graph.nodes.some((node) => node.id === preferred)) return preferred;
  let index = 2;
  while (graph.nodes.some((node) => node.id === `${preferred}_${index}`)) index += 1;
  return `${preferred}_${index}`;
}

function uniqueEdgeId(graph: GraphFrame["graph"], edge: Pick<GraphEdge, "from" | "to" | "type">): string {
  const base = `edge_${safeWorkerId(edge.from)}_${edge.type}_${safeWorkerId(edge.to)}`;
  if (!graph.edges.some((item) => item.id === base)) return base;
  let index = 2;
  while (graph.edges.some((item) => item.id === `${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function edgeKey(edge: Pick<GraphEdge, "from" | "to" | "type">): string {
  return `${edge.from}\u0000${edge.type}\u0000${edge.to}`;
}

function rewriteNode(node: GraphNode, id: string, renames: Map<string, string>): GraphNode {
  return { ...node, id, data: rewriteUnknown(node.data, renames) as Record<string, unknown> | undefined };
}

function rewriteEdge(edge: GraphEdge, renames: Map<string, string>): GraphEdge {
  return { ...edge, from: renames.get(edge.from) ?? edge.from, to: renames.get(edge.to) ?? edge.to };
}

function rewriteUnknown(value: unknown, renames: Map<string, string>): unknown {
  if (typeof value === "string") return renames.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteUnknown(item, renames));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteUnknown(item, renames)]));
}

function hasNode(graph: GraphFrame["graph"], id: string): boolean {
  return graph.nodes.some((node) => node.id === id);
}

function safeWorkerId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "worker";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
