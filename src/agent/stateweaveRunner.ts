import { applyOps, addToolResult } from "../core/applyOps.js";
import { appendInputToGraphFrame, assertValidGraphFrame, cloneFrame, createInitialGraphFrame, forkFrame, forkFrameMetadataOnly, nowIso } from "../core/graph.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import { serializeGraphFrame } from "../core/serialize.js";
import type { AgentResult, GraphEdge, GraphFrame, GraphNode, GraphOp, StateWeaveRunMetadata, StateWeaveStreamEvent, TraceStep, WorkerRunSummary } from "../core/types.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";

export type StateWeaveInput = TaskInput;
export type StateWeaveRunOptions = { frame?: GraphFrame; inputAlreadyAppended?: boolean; signal?: AbortSignal };
export type StateWeaveRunnerArgs = { model: Model; tools: Tool[]; maxIterations?: number; maxNoProgressIterations?: number; maxPromptTokens?: number; systemPrompt?: string; nodeTypes?: string[]; traceMode?: "full" | "compact"; blindIdentity?: boolean; providerSystem?: string };

export class StateWeaveRunError extends Error {
  trace: TraceStep[];
  metadata: StateWeaveRunMetadata;
  frame?: GraphFrame;

  constructor(message: string, trace: TraceStep[], metadata: StateWeaveRunMetadata, frame?: GraphFrame) {
    super(message);
    this.name = "StateWeaveRunError";
    this.trace = trace;
    this.metadata = metadata;
    this.frame = frame ? cloneFrame(frame) : undefined;
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
  assertValidGraphFrame(frame);
  const trace: TraceStep[] = [];
  const maxIterations = args.maxIterations ?? 30;
  const maxPromptTokens = args.maxPromptTokens ?? 64_000;
  const runId = runIdForNow();
  const startedAt = new Date();
  let retryCount = 0;
  let finalAnswer = "";
  let mutationSucceeded = false;
  let inspectionSucceeded = false;
  let verificationSucceeded = false;
  let checkSucceeded = false;
  let restartSucceeded = false;
  let smokeSucceeded = false;
  let toolActivitySucceeded = false;
  let lastWorkspaceMutationStep = 0;
  const maxNoProgressIterations = args.maxNoProgressIterations;
  const mutatedPaths = new Set<string>();
  const inspectedPaths = new Set<string>();
  const taskText = `${task.objective}\n${task.input}`;
  const mutationRequested = hasMutationIntent(taskText);
  const verificationRequested = hasVerificationIntent(taskText);
  const checkRequested = hasCheckIntent(taskText);
  const restartRequested = hasRestartIntent(taskText);
  const smokeRequested = hasSmokeIntent(taskText);
  const configuredSemanticNodeTypes = normalizeSemanticNodeTypes(args.nodeTypes ?? frame.frame.nodeTypes ?? []);
  const runStartNodeIds = new Set(frame.graph.nodes.map((node) => node.id));
  const toolInfo = [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description }));

  options?.signal?.throwIfAborted();
  yield { type: "metadata", metadata: runMetadata(runId, toolInfo, startedAt, maxIterations, maxPromptTokens, trace, retryCount, "running") };

  for (let step = 1; step <= maxIterations; step++) {
    options?.signal?.throwIfAborted();
    const stepStartedAt = new Date();
    const frameBefore = frame;
    const prompt = serializeGraphFrame(frameBefore, { blindIdentity: args.blindIdentity, maxTokens: maxPromptTokens });
    const streamedTokens: string[] = [];
    const modelMetadata: Record<string, unknown>[] = [];

    yield { type: "frame", step, phase: "before", frame: frameBefore, prompt, tokenEstimate: estimateStateWeaveTokens(prompt) };
    for await (const event of args.model.stream({ prompt, frame: frameBefore, mode: "graph_ops", signal: options?.signal, system: args.providerSystem })) {
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
      validateToolTransaction(parsedOps);
      validateEditInspection(parsedOps, inspectedPaths, mutatedPaths);
      const candidateFrame = applyOps(frame, parsedOps);
      validateSemanticToolPlan(parsedOps, candidateFrame, { configuredSemanticNodeTypes, runStartNodeIds, toolActivitySucceeded });
      validateFinalEvidence(parsedOps, {
        mutationRequested,
        mutationSucceeded,
        inspectionSucceeded,
        verificationRequested,
        verificationSucceeded,
        checkRequested,
        checkSucceeded,
        restartRequested,
        restartSucceeded,
        smokeRequested,
        smokeSucceeded,
        mutatedPaths
      });
      validateSemanticCompletion(parsedOps, candidateFrame, { configuredSemanticNodeTypes, runStartNodeIds, mutationRequested, verificationRequested, toolActivitySucceeded });
      yield { type: "ops", step, ops: parsedOps };
      const toolOutcome = await runToolOps(frame, candidateFrame, parsedOps, tools, step);
      options?.signal?.throwIfAborted();
      frame = toolOutcome.frame;
      if (toolOutcome.mutationSucceeded) {
        mutationSucceeded = true;
        lastWorkspaceMutationStep = step;
        verificationSucceeded = false;
        checkSucceeded = false;
        restartSucceeded = false;
        smokeSucceeded = false;
      }
      toolActivitySucceeded ||= toolOutcome.toolActivitySucceeded;
      inspectionSucceeded ||= toolOutcome.inspectionSucceeded;
      verificationSucceeded ||= toolOutcome.verificationSucceeded;
      checkSucceeded ||= toolOutcome.checkSucceeded;
      restartSucceeded ||= toolOutcome.restartSucceeded;
      smokeSucceeded ||= toolOutcome.smokeSucceeded;
      if (toolOutcome.inspectedPath) inspectedPaths.add(toolOutcome.inspectedPath);
      if (toolOutcome.mutatedPath) mutatedPaths.add(toolOutcome.mutatedPath);
      if (hasWorkers(parsedOps)) {
        const scheduler = scheduleWorkers(frame, parsedOps, args, step, maxIterations, options?.signal);
        frame = scheduler.frame;
        for await (const event of scheduler.events) yield event;
        frame = mergeWorkerExecutions(frame, await scheduler.done);
        yield { type: "worker", step, phase: "merged", worker: mergedWorkersSummary(parsedOps), frame: cloneFrame(frame) };
      }
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason;
      const message = error instanceof Error ? error.message : String(error);
      const frameAfter = frame;
      trace.push(traceStep({ step, startedAt: stepStartedAt, frameBefore, prompt, streamedTokens, modelMetadata, rawModelOutput, parsedOps, frameAfter, error: message }, args.traceMode));
      const retryable = step < maxIterations;
      yield { type: "error", step, message, retryable };
      if (!retryable) throw new StateWeaveRunError(`StateWeave GraphOps failed after ${step} step(s): ${message}`, trace, runMetadata(runId, toolInfo, startedAt, maxIterations, maxPromptTokens, trace, retryCount, "error"), frame);
      retryCount += 1;
      frame = retryFrameAfterGraphOpsError(frame, message);
      continue;
    }

    const final = parsedOps.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
    if (final) finalAnswer = final.answer;

    const frameAfter = frame;
    trace.push(traceStep({ step, startedAt: stepStartedAt, frameBefore, prompt, streamedTokens, modelMetadata, rawModelOutput, parsedOps, frameAfter }, args.traceMode));
    yield { type: "frame", step, phase: "after", frame: frameAfter };
    if (finalAnswer) break;
    if (maxNoProgressIterations && step - lastWorkspaceMutationStep >= maxNoProgressIterations) {
      throw new StateWeaveRunError(
        `No successful workspace mutation occurred in ${maxNoProgressIterations} consecutive model iterations; stopping the non-convergent run with its frame and trace preserved.`,
        trace,
        runMetadata(runId, toolInfo, startedAt, maxIterations, maxPromptTokens, trace, retryCount, "error"),
        frame
      );
    }
  }

  if (!finalAnswer) {
    throw new StateWeaveRunError(
      `Recursion limit reached after ${maxIterations} iteration(s); consider increasing maxIterations.`,
      trace,
      runMetadata(runId, toolInfo, startedAt, maxIterations, maxPromptTokens, trace, retryCount, "error"),
      frame
    );
  }
  yield { type: "final", result: { finalAnswer, frame, graph: frame.graph, trace, metadata: runMetadata(runId, toolInfo, startedAt, maxIterations, maxPromptTokens, trace, retryCount, "done") } };
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
}, traceMode: "full" | "compact" = "full"): TraceStep {
  const completedAt = new Date();
  return {
    step: args.step,
    startedAt: args.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - args.startedAt.getTime(),
    frameBefore: traceMode === "compact" ? compactTraceFrame(args.frameBefore) : args.frameBefore,
    prompt: traceMode === "compact" ? "" : args.prompt,
    tokenEstimate: estimateStateWeaveTokens(args.prompt),
    streamedTokens: traceMode === "compact" ? [] : args.streamedTokens,
    ...(args.modelMetadata.length ? { modelMetadata: args.modelMetadata } : {}),
    rawModelOutput: args.rawModelOutput,
    parsedOps: args.parsedOps,
    frameAfter: traceMode === "compact" ? compactTraceFrame(args.frameAfter) : args.frameAfter,
    ...(args.error ? { error: args.error } : {})
  };
}

function compactTraceFrame(frame: GraphFrame): GraphFrame {
  return { frame: forkFrameMetadataOnly(frame).frame, graph: { nodes: [], edges: [] } };
}

function runMetadata(
  runId: string,
  tools: StateWeaveRunMetadata["tools"],
  startedAt: Date,
  maxIterations: number,
  maxPromptTokens: number,
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
    maxPromptTokens,
    stepCount: trace.length,
    retryCount,
    status
  };
}

function runIdForNow(): string {
  return `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function retryFrameAfterGraphOpsError(frame: GraphFrame, message: string): GraphFrame {
  const next = forkFrameMetadataOnly(frame);
  next.frame.lastGraphOpsError = message;
  next.frame.currentFocus = `Previous GraphOps transaction was rejected: ${message}`;
  next.frame.nextExpectedOutput = recoveryInstruction(message);
  return next;
}

type ToolOutcome = {
  frame: GraphFrame;
  toolActivitySucceeded: boolean;
  mutationSucceeded: boolean;
  inspectionSucceeded: boolean;
  verificationSucceeded: boolean;
  checkSucceeded: boolean;
  restartSucceeded: boolean;
  smokeSucceeded: boolean;
  inspectedPath?: string;
  mutatedPath?: string;
};

const emptyToolOutcome = (frame: GraphFrame): ToolOutcome => ({
  frame,
  toolActivitySucceeded: false,
  mutationSucceeded: false,
  inspectionSucceeded: false,
  verificationSucceeded: false,
  checkSucceeded: false,
  restartSucceeded: false,
  smokeSucceeded: false
});

async function runToolOps(originalFrame: GraphFrame, candidateFrame: GraphFrame, ops: GraphOp[], tools: Map<string, Tool>, step: number): Promise<ToolOutcome> {
  const op = ops.find((item): item is Extract<GraphOp, { op: "call_tool" }> => item.op === "call_tool");
  if (!op) return emptyToolOutcome(candidateFrame);
  const tool = tools.get(op.tool);
  if (!tool) throw new Error(`Unknown tool: ${op.tool}`);
  const parsedArgs = tool.schema.parse(op.args);
  try {
    const result = await tool.execute(parsedArgs);
    if (!toolExecutionSucceeded(op.tool, result)) return failedToolOutcome(originalFrame, op, result, step, toolFailureMessage(op.tool, result));
    const taskAnchorId = semanticTaskAnchorId(candidateFrame);
    const next = { ...candidateFrame, graph: addToolResult(candidateFrame.graph, { tool: op.tool, toolArgs: op.args, result, step, ok: true, anchorId: taskAnchorId }) };
    next.frame.currentFocus = `The ${op.tool} operation succeeded. Inspect its typed tool_result before deciding whether to verify or finalize.`;
    next.frame.nextExpectedOutput = isMutatingTool(op.tool)
      ? "Verify the mutation with the requested check/restart/smoke action, record the resolved test_result, then return a factual final answer."
      : "Use this observation as ground truth, update the semantic task record, and choose one next operation or a supported final answer.";
    const appAction = op.tool === "app_control" && typeof op.args.action === "string" ? op.args.action : undefined;
    const path = toolPath(op.args);
    return {
      frame: next,
      toolActivitySucceeded: true,
      mutationSucceeded: isMutatingTool(op.tool),
      inspectionSucceeded: op.tool === "read_file",
      verificationSucceeded: op.tool === "read_file" || op.tool === "bash_command" || op.tool === "app_control",
      checkSucceeded: op.tool === "bash_command" || (op.tool === "app_control" && appAction === "check"),
      restartSucceeded: op.tool === "app_control" && appAction === "restart",
      smokeSucceeded: op.tool === "app_control" && (appAction === "smoke" || appAction === "restart"),
      ...(op.tool === "read_file" && path ? { inspectedPath: path } : {}),
      ...(isMutatingTool(op.tool) && path ? { mutatedPath: path } : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = { ok: false, error: message, tool: op.tool, args: safeToolArgs(op.args) };
    return failedToolOutcome(originalFrame, op, result, step, message);
  }
}

function failedToolOutcome(originalFrame: GraphFrame, op: Extract<GraphOp, { op: "call_tool" }>, result: unknown, step: number, message: string): ToolOutcome {
  const next = forkFrameMetadataOnly(originalFrame);
  next.graph = addToolResult(next.graph, { tool: op.tool, toolArgs: op.args, result, step, ok: false, anchorId: semanticTaskAnchorId(originalFrame) });
  next.frame.lastGraphOpsError = `Tool ${op.tool} failed: ${message}`;
  next.frame.currentFocus = `The ${op.tool} operation failed without committing its proposed semantic GraphOps. Use the rejected tool_result and current file evidence to correct the call.`;
  next.frame.nextExpectedOutput = "Do not claim success. Address the concrete failure, re-read stale files when needed, then retry one corrected tool operation.";
  return emptyToolOutcome(next);
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

function validateToolTransaction(ops: GraphOp[]): void {
  const toolCalls = ops.filter((op): op is Extract<GraphOp, { op: "call_tool" }> => op.op === "call_tool");
  if (!toolCalls.length) return;
  if (toolCalls.length > 1 || ops.some((op) => op.op === "final" || op.op === "spawn_worker")) {
    throw new Error("Tool execution is evidence-producing and isolated: call exactly one tool in a transaction without @final or @worker, inspect its typed tool_result, then continue.");
  }
}

function validateEditInspection(ops: GraphOp[], inspectedPaths: Set<string>, mutatedPaths: Set<string>): void {
  const edit = ops.find((op): op is Extract<GraphOp, { op: "call_tool" }> => op.op === "call_tool" && op.tool === "edit_file");
  if (!edit) return;
  const path = toolPath(edit.args);
  if (path && !inspectedPaths.has(path) && !mutatedPaths.has(path)) {
    throw new Error(`edit_file requires current evidence for ${path}. Read that file first, then retry the edit with the observed content/hash.`);
  }
}

function validateSemanticToolPlan(
  ops: GraphOp[],
  candidateFrame: GraphFrame,
  evidence: { configuredSemanticNodeTypes: string[]; runStartNodeIds: Set<string>; toolActivitySucceeded: boolean }
): void {
  if (evidence.toolActivitySucceeded || !evidence.configuredSemanticNodeTypes.length || !ops.some((op) => op.op === "call_tool")) return;
  const semanticNodes = runSemanticNodes(candidateFrame, evidence.runStartNodeIds);
  if (!semanticNodes.length) {
    throw new Error(`The first tool transaction must create an active semantic work node. Prefer one configured type (${evidence.configuredSemanticNodeTypes.join(", ")}); these are suggestions, so a clear custom type is allowed when none fits.`);
  }
  if (evidence.configuredSemanticNodeTypes.includes("task") && !semanticNodes.some((node) => node.type === "task" && node.status !== "resolved")) {
    throw new Error("The configured task type fits this tool-using request. Create one active task node in the first tool transaction; custom node types may supplement it, not replace an applicable suggested type.");
  }
}

type FinalEvidence = {
  mutationRequested: boolean;
  mutationSucceeded: boolean;
  inspectionSucceeded: boolean;
  verificationRequested: boolean;
  verificationSucceeded: boolean;
  checkRequested: boolean;
  checkSucceeded: boolean;
  restartRequested: boolean;
  restartSucceeded: boolean;
  smokeRequested: boolean;
  smokeSucceeded: boolean;
  mutatedPaths: Set<string>;
};

function validateFinalEvidence(ops: GraphOp[], evidence: FinalEvidence): void {
  const final = ops.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
  if (!final) return;
  if (evidence.mutationRequested && !evidence.mutationSucceeded) {
    if (final.outcome !== "already_satisfied") {
      throw new Error("Final answer requires workspace mutation evidence. If inspection proves the requested state already exists, verify it and use outcome=already_satisfied; otherwise perform the mutation first.");
    }
    if (!evidence.inspectionSucceeded) {
      throw new Error("outcome=already_satisfied requires successful read_file evidence from this run.");
    }
  }
  const unsupportedPaths = final.outcome === "already_satisfied" ? [] : workspacePaths(final.answer).filter((filePath) => /\b(created|wrote|updated|edited|changed|fixed|implemented|removed|replaced)\b/i.test(final.answer) && !evidence.mutatedPaths.has(filePath));
  if (unsupportedPaths.length) {
    throw new Error(`Final answer claims changes to ${unsupportedPaths.join(", ")}, but this run has no successful mutation evidence for those paths.`);
  }
  if (evidence.checkRequested && !evidence.checkSucceeded) {
    throw new Error("The task explicitly requests checks/tests, but no successful bash_command or app_control action=check result exists. Run the check before finalizing.");
  }
  if (evidence.restartRequested && !evidence.restartSucceeded) {
    throw new Error("The task explicitly requests a restart, but no successful app_control action=restart result exists. Restart before finalizing.");
  }
  if (evidence.smokeRequested && !evidence.smokeSucceeded) {
    throw new Error("The task explicitly requests a smoke check, but no successful app_control action=smoke or action=restart result exists. Smoke-check before finalizing.");
  }
  if (evidence.verificationRequested && evidence.mutationSucceeded && !evidence.verificationSucceeded) {
    throw new Error("The task explicitly requests verification, but no successful post-mutation read_file, bash_command, or app_control result exists. Verify before finalizing.");
  }
}

function validateSemanticCompletion(
  ops: GraphOp[],
  candidateFrame: GraphFrame,
  evidence: { configuredSemanticNodeTypes: string[]; runStartNodeIds: Set<string>; mutationRequested: boolean; verificationRequested: boolean; toolActivitySucceeded: boolean }
): void {
  if (!ops.some((op) => op.op === "final") || !evidence.configuredSemanticNodeTypes.length) return;
  if (!evidence.mutationRequested && !evidence.verificationRequested && !evidence.toolActivitySucceeded) return;
  const semanticNodes = runSemanticNodes(candidateFrame, evidence.runStartNodeIds);
  if (!semanticNodes.length) {
    throw new Error(`A non-trivial StateWeave turn must preserve semantic memory before @final. Create and connect a durable work node, preferring configured types: ${evidence.configuredSemanticNodeTypes.join(", ")}. Custom semantic types remain allowed when none fits.`);
  }
  const taskNodes = semanticNodes.filter((node) => node.type === "task");
  if (evidence.configuredSemanticNodeTypes.includes("task")) {
    if (!taskNodes.length) throw new Error("This request fits the configured task type. Add a task node connected to the current work before finalizing.");
    if (!taskNodes.some((node) => node.status === "resolved")) throw new Error("Verification is complete only when the current task node is updated to status=resolved.");
  }
  if (evidence.verificationRequested && evidence.configuredSemanticNodeTypes.includes("test_result")) {
    const testResults = semanticNodes.filter((node) => node.type === "test_result" && node.status === "resolved");
    if (!testResults.length) throw new Error("Record the successful verification as a resolved test_result node before finalizing.");
    const linkedToEvidence = testResults.some((node) => linkedNodeTypes(candidateFrame, node.id).has("tool_result"));
    const linkedToTask = !taskNodes.length || testResults.some((node) => linkedNodeTypes(candidateFrame, node.id).has("task"));
    if (!linkedToEvidence || !linkedToTask) throw new Error("Connect the resolved test_result to its successful tool_result evidence and to the current task with validates/supports edges before finalizing.");
  }
}

function hasMutationIntent(text: string): boolean {
  const mutation = /\b(create|write|edit|change|update|set|increase|decrease|fix|implement|remove|replace|modify)\b/i.test(text);
  const workspaceTarget = /\b(file|workspace|manifest|module|source|document)|(?:^|\s)[a-z0-9_./-]+\.(?:js|ts|json|md|txt|html|css|svg)\b/i.test(text);
  return mutation && workspaceTarget;
}

function hasVerificationIntent(text: string): boolean {
  return /\b(verify|verification|run\s+[^.\n]*(?:check|test)|node\s+--check|test(?:s|ing)?|check|smoke|restart)\b/i.test(text);
}

function hasCheckIntent(text: string): boolean {
  const withoutSmoke = text.replace(/smoke[- ]?(?:check|test)/gi, "");
  return /\b(?:run|running|execute)[^.\n]*(?:checks?|tests?)\b|\b(?:syntax|project|regression|unit|integration)\s*(?:\/|and\s+)?\s*(?:checks?|tests?)\b|\btests?\b|node\s+--check|app_control\s+action=check/i.test(withoutSmoke);
}

function hasRestartIntent(text: string): boolean {
  return /\brestart(?:ed|ing)?\b/i.test(text);
}

function hasSmokeIntent(text: string): boolean {
  return /\bsmoke(?:[- ]?(?:check|test))(?:ed|ing)?\b|\bsmoke-check\b/i.test(text);
}

function isMutatingTool(tool: string): boolean {
  return tool === "write_file" || tool === "edit_file";
}

function bashSucceeded(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { exitCode?: unknown }).exitCode === 0);
}

function appControlSucceeded(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  if (typeof record.ok === "boolean") return record.ok;
  if (typeof record.healthy === "boolean" || typeof record.pageOk === "boolean") return record.healthy === true && record.pageOk === true;
  return record.running === true;
}

function toolExecutionSucceeded(tool: string, result: unknown): boolean {
  if (tool === "bash_command") return bashSucceeded(result);
  if (tool === "app_control") return appControlSucceeded(result);
  return !(result && typeof result === "object" && (result as Record<string, unknown>).ok === false);
}

function toolFailureMessage(tool: string, result: unknown): string {
  if (!result || typeof result !== "object") return `${tool} reported an unsuccessful result.`;
  const record = result as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  const frontend = record.frontend;
  if (frontend && typeof frontend === "object") {
    const detail = frontend as Record<string, unknown>;
    const missing = Array.isArray(detail.missingElementIds) ? detail.missingElementIds.join(", ") : "";
    const unstyled = Array.isArray(detail.unstyledClasses) ? detail.unstyledClasses.join(", ") : "";
    if (missing || unstyled) return `frontend coherence failed${missing ? `; missing element ids: ${missing}` : ""}${unstyled ? `; unstyled classes: ${unstyled}` : ""}`;
  }
  const acceptance = record.acceptance;
  if (acceptance && typeof acceptance === "object" && Array.isArray((acceptance as Record<string, unknown>).details)) {
    return `acceptance checks failed: ${((acceptance as Record<string, unknown>).details as unknown[]).map(String).join(", ")}`;
  }
  return `${tool} reported an unsuccessful result: ${JSON.stringify(result).slice(0, 1200)}`;
}

function semanticTaskAnchorId(frame: GraphFrame): string | undefined {
  const inputId = frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId;
  if (!inputId) return undefined;
  return [...frame.graph.nodes].reverse().find((node) => node.type === "task" && node.status !== "rejected" && node.status !== "stale" && frame.graph.edges.some((edge) => (edge.from === inputId && edge.to === node.id) || (edge.to === inputId && edge.from === node.id)))?.id;
}

function runSemanticNodes(frame: GraphFrame, runStartNodeIds: Set<string>): GraphNode[] {
  return frame.graph.nodes.filter((node) => !runStartNodeIds.has(node.id) && !isStructuralNodeType(node.type));
}

function linkedNodeTypes(frame: GraphFrame, nodeId: string): Set<string> {
  const linkedIds = new Set(frame.graph.edges.flatMap((edge) => edge.from === nodeId ? [edge.to] : edge.to === nodeId ? [edge.from] : []));
  return new Set(frame.graph.nodes.filter((node) => linkedIds.has(node.id)).map((node) => node.type));
}

function normalizeSemanticNodeTypes(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter((value) => /^[a-z][a-z0-9_-]{0,63}$/.test(value) && !isStructuralNodeType(value)));
}

function isStructuralNodeType(type: string): boolean {
  return type === "system" || type === "user_input" || type === "assistant_output" || type === "tool_call" || type === "tool_result";
}

function swxSyntaxRecovery(message: string): string | undefined {
  const match = message.match(/Invalid SWX @(\w+) command/);
  if (!match) return undefined;
  const command = match[1];
  if (command === "edge") {
    return "That @edge line is malformed and will be rejected again if repeated unchanged. An edge needs exactly three tokens \u2014 @edge <from-id> <type> <to-id> \u2014 where <from-id> and <to-id> reference existing nodes and <type> is one of: follows, creates, supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to. Either re-emit one corrected @edge line, or drop the bad line and proceed with the rest of the transaction; never repeat the identical invalid line.";
  }
  if (command === "node") {
    return "That @node line is malformed. A node needs @node <id> <type> (lowercase id and a valid node type) plus optional [text=... status=...]. Re-emit it corrected or drop it and proceed with the rest of the transaction; never repeat the identical invalid line.";
  }
  if (command === "update") {
    return "That @update line is malformed. It needs @update <existing-id> plus optional [text=... status=... type=...]. Re-emit it corrected or drop it and proceed with the rest of the transaction; never repeat the identical invalid line.";
  }
  return `That @${command} line is malformed and will be rejected again if repeated unchanged. Re-emit a single corrected line or drop it and proceed with the rest of the transaction; never repeat the identical invalid line.`;
}

function recoveryInstruction(message: string): string {
  const syntax = swxSyntaxRecovery(message);
  if (syntax) return syntax;
  if (/first tool transaction must create|configured task type/i.test(message)) return "Retry the tool transaction with one active task node using a configured semantic type. StateWeave will connect structural nodes automatically; do not duplicate them.";
  if (/test_result/i.test(message)) return "Add a resolved test_result node, connect the successful tool_result to it and connect it to the current task with validates edges, resolve the task, then return @final.";
  if (/restart/i.test(message)) return "Call exactly @tool app_control action=restart, inspect the result, then update semantic verification nodes and finalize.";
  if (/smoke/i.test(message)) return "Call exactly @tool app_control action=smoke (or action=restart when restart is also required), inspect the result, then finalize from evidence.";
  if (/checks?\/tests?|action=check/i.test(message)) return "Call exactly @tool app_control action=check (or a permitted bash check), inspect the result, then record test_result evidence and finalize.";
  if (/read that file first|current evidence/i.test(message)) return "Call exactly one read_file for the named path, inspect the returned content/hash, then retry the edit.";
  if (/verification/i.test(message)) return "Run the requested verification as one tool transaction, inspect its typed tool_result, then resolve the task and finalize.";
  return "Retry only the rejected operation. Do not rebuild structural nodes. Inspect rejected tool_result evidence before trying a corrected tool call, and never claim unsupported success.";
}

function toolPath(args: Record<string, unknown>): string | undefined {
  return typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : undefined;
}

function workspacePaths(text: string): string[] {
  return unique(text.match(/\b(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:js|ts|json|md|txt|html|css|svg)\b/gi) ?? []);
}

function safeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ["file_path", "path", "command", "expected_hash", "expectedHash"]) {
    if (args[key] !== undefined) safe[key] = args[key];
  }
  return safe;
}

function workerOps(ops: GraphOp[]): Extract<GraphOp, { op: "spawn_worker" }>[] {
  return ops.filter((op): op is Extract<GraphOp, { op: "spawn_worker" }> => op.op === "spawn_worker");
}

function scheduleWorkers(
  frame: GraphFrame,
  ops: GraphOp[],
  args: StateWeaveRunnerArgs,
  step: number,
  parentMaxIterations: number,
  signal?: AbortSignal
): { frame: GraphFrame; events: AsyncIterable<StateWeaveStreamEvent>; done: Promise<WorkerExecution[]> } {
  const { frame: preparedFrame, plans } = prepareWorkerPlans(frame, workerOps(ops));
  const queue = new AsyncEventQueue<StateWeaveStreamEvent>();
  const executions = Promise.all(plans.map((plan) => runWorker(plan, preparedFrame, args, step, parentMaxIterations, queue, signal))).finally(() => queue.close());
  return { frame: preparedFrame, events: queue, done: executions };
}

function prepareWorkerPlans(frame: GraphFrame, ops: Extract<GraphOp, { op: "spawn_worker" }>[]): { frame: GraphFrame; plans: WorkerPlan[] } {
  const next = forkFrame(frame);
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
  queue: AsyncEventQueue<StateWeaveStreamEvent>,
  signal?: AbortSignal
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
      { frame: workerFrame, inputAlreadyAppended: true, signal }
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
    if (signal?.aborted) throw signal.reason;
    const message = error instanceof Error ? error.message : String(error);
    queue.push({ type: "worker", step: parentStep, phase: "error", worker: workerSummary(plan, "error", { error: message }) });
    return { plan, baseFrame: workerFrame, error: message };
  }
}

function workerFrameFor(baseFrame: GraphFrame, plan: WorkerPlan): GraphFrame {
  const frame = forkFrameMetadataOnly(baseFrame);
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
  let next = forkFrame(frame);
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
  const next = forkFrame(currentFrame);
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
