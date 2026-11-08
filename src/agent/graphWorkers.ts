// Graph workers: spawn sub-runs on a focused copy of the frame, then merge their new nodes back.
import { cloneFrame, forkFrame, forkFrameMetadataOnly, nowIso } from "../core/graph.js";
import { addEdge, hasNode, unique, uniqueNodeId } from "../core/graphEdit.js";
import { withoutUndefined } from "../core/opsText.js";
import type { GraphEdge, GraphFrame, GraphFrameRunResult, GraphNode, GraphOp, StateGraph, StateWeaveStreamEvent, WorkerRunSummary } from "../core/types.js";

type SpawnOp = Extract<GraphOp, { op: "spawn_worker" }>;
type WorkerPlan = { id: string; taskNodeId: string; resultNodeId: string; objective: string; input?: string; focusNodeId?: string; maxIterations?: number };
type WorkerExecution = { plan: WorkerPlan; baseFrame: GraphFrame; result?: GraphFrameRunResult; error?: string };

/** Runs one worker to completion; supplied by the runner to avoid a module cycle. */
export type WorkerRun = (objective: string, input: string, frame: GraphFrame, maxIterations: number | undefined) => AsyncIterable<StateWeaveStreamEvent>;

export function workerOps(ops: GraphOp[]): SpawnOp[] {
  return ops.filter((op): op is SpawnOp => op.op === "spawn_worker");
}

export async function* runWorkers(frame: GraphFrame, ops: SpawnOp[], step: number, run: WorkerRun, signal?: AbortSignal): AsyncGenerator<StateWeaveStreamEvent, GraphFrame> {
  const { frame: prepared, plans } = prepareWorkerPlans(frame, ops);
  const queue = new AsyncEventQueue<StateWeaveStreamEvent>();
  const done = Promise.all(plans.map((plan) => runWorker(plan, prepared, step, run, queue, signal))).finally(() => queue.close());
  for await (const event of queue) yield event;
  const merged = mergeWorkerExecutions(prepared, await done);
  const count = ops.length;
  yield { type: "worker", step, phase: "merged", worker: { id: "scheduler", objective: `Merged ${count} worker${count === 1 ? "" : "s"}`, status: "merged" }, frame: cloneFrame(merged) };
  return merged;
}

function prepareWorkerPlans(frame: GraphFrame, ops: SpawnOp[]): { frame: GraphFrame; plans: WorkerPlan[] } {
  const next = forkFrame(frame);
  const plans = ops.map((op): WorkerPlan => {
    const safeId = safeWorkerId(op.id);
    const taskNodeId = uniqueNodeId(next.graph.nodes, `worker_task_${safeId}`);
    const focusNodeId = [op.focusNodeId, next.frame.focusNodeId, next.frame.activeUserInputNodeId].find((id): id is string => Boolean(id) && hasNode(next.graph, id!)) ?? "system_root";
    next.graph.nodes.push({ id: taskNodeId, type: "worker_task", text: op.objective, data: withoutUndefined({ workerId: op.id, focusNodeId, input: op.input, status: "queued" }), status: "active", confidence: 1, createdAt: nowIso() });
    if (hasNode(next.graph, focusNodeId)) addEdge(next.graph, focusNodeId, taskNodeId, "relates_to");
    return { id: op.id, taskNodeId, resultNodeId: uniqueNodeId(next.graph.nodes, `worker_result_${safeId}`), objective: op.objective, input: op.input, focusNodeId, maxIterations: op.maxIterations };
  });
  next.frame.currentFocus = `Queued ${plans.length} worker${plans.length === 1 ? "" : "s"}; wait for worker_result nodes.`;
  next.frame.nextExpectedOutput = "After workers merge, F one answer summarizing worker_result nodes.";
  next.frame.candidateFocusNodeIds = unique([...plans.map((plan) => plan.taskNodeId), ...(next.frame.candidateFocusNodeIds ?? [])]);
  return { frame: next, plans };
}

async function runWorker(plan: WorkerPlan, baseFrame: GraphFrame, step: number, run: WorkerRun, queue: AsyncEventQueue<StateWeaveStreamEvent>, signal?: AbortSignal): Promise<WorkerExecution> {
  const workerFrame = workerFrameFor(baseFrame, plan);
  const emit = (phase: Extract<StateWeaveStreamEvent, { type: "worker" }>["phase"], status: WorkerRunSummary["status"], extra: Partial<WorkerRunSummary> = {}, more: { token?: string; ops?: GraphOp[] } = {}) =>
    queue.push({ type: "worker", step, phase, worker: withoutUndefined({ id: plan.id, objective: plan.objective, focusNodeId: plan.focusNodeId, status, ...extra }), ...more });
  emit("queued", "queued");
  emit("started", "running");
  let result: GraphFrameRunResult | undefined;
  try {
    for await (const event of run(plan.objective, plan.input ?? plan.objective, workerFrame, plan.maxIterations)) {
      if (event.type === "token") emit("token", "running", {}, { token: event.token });
      else if (event.type === "ops") emit("ops", "running", {}, { ops: event.ops });
      else if (event.type === "error") emit(event.retryable ? "retrying" : "error", event.retryable ? "retrying" : "error", { error: event.message });
      else if (event.type === "frame" && event.phase === "after") emit("ops", "running", { nodeCount: event.frame.graph.nodes.length, edgeCount: event.frame.graph.edges.length });
      else if (event.type === "final") result = event.result;
    }
    if (!result) throw new Error("Worker stream ended without a final result.");
    emit("done", "done", { finalAnswer: result.finalAnswer, nodeCount: result.graph.nodes.length, edgeCount: result.graph.edges.length });
    return { plan, baseFrame: workerFrame, result };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const message = error instanceof Error ? error.message : String(error);
    emit("error", "error", { error: message });
    return { plan, baseFrame: workerFrame, error: message };
  }
}

function workerFrameFor(baseFrame: GraphFrame, plan: WorkerPlan): GraphFrame {
  const frame = forkFrameMetadataOnly(baseFrame);
  Object.assign(frame.frame, {
    objective: plan.objective,
    currentFocus: `Worker ${plan.id}: ${plan.objective}. Connect new nodes to ${plan.taskNodeId}.`,
    focusNodeId: plan.taskNodeId,
    latestInputNodeId: undefined,
    activeUserInputNodeId: undefined,
    candidateFocusNodeIds: unique([plan.taskNodeId, ...(plan.focusNodeId ? [plan.focusNodeId] : []), "system_root"]),
    nextExpectedOutput: `Complete "${plan.objective}", then F a concise worker result.`
  });
  return frame;
}

function mergeWorkerExecutions(frame: GraphFrame, executions: WorkerExecution[]): GraphFrame {
  let next = forkFrame(frame);
  const resultIds: string[] = [];
  for (const execution of executions) {
    const task = next.graph.nodes.find((node) => node.id === execution.plan.taskNodeId);
    if (task) {
      task.status = execution.result ? "resolved" : "rejected";
      task.data = { ...task.data, status: execution.result ? "done" : "error", ...(execution.error ? { error: execution.error } : {}) };
    }
    if (execution.result) next = mergeWorkerGraph(next, execution.result.frame, execution.baseFrame);
    const resultNode = addWorkerResultNode(next.graph, execution);
    resultIds.push(resultNode.id);
    addEdge(next.graph, execution.plan.taskNodeId, resultNode.id, execution.result ? "validates" : "contradicts");
  }
  const done = executions.filter((item) => item.result).length;
  const failed = executions.length - done;
  next.frame.currentFocus = `Merged ${done} worker${done === 1 ? "" : "s"}${failed ? ` and ${failed} failure${failed === 1 ? "" : "s"}` : ""}.`;
  next.frame.nextExpectedOutput = "F one human answer summarizing worker outcomes; reference artifacts, do not paste transcripts.";
  next.frame.focusNodeId = resultIds[0] ?? next.frame.focusNodeId;
  next.frame.candidateFocusNodeIds = unique([...resultIds, ...(next.frame.candidateFocusNodeIds ?? [])]);
  return next;
}

function mergeWorkerGraph(currentFrame: GraphFrame, resultFrame: GraphFrame, baseFrame: GraphFrame): GraphFrame {
  const next = forkFrame(currentFrame);
  const baseNodeIds = new Set(baseFrame.graph.nodes.map((node) => node.id));
  const baseEdgeKeys = new Set(baseFrame.graph.edges.map(edgeKey));
  const newNodes = resultFrame.graph.nodes.filter((node) => !baseNodeIds.has(node.id));
  const renames = new Map(newNodes.filter((node) => hasNode(next.graph, node.id)).map((node) => [node.id, uniqueNodeId(next.graph.nodes, node.id)]));
  for (const node of newNodes) {
    const id = renames.get(node.id) ?? node.id;
    if (!hasNode(next.graph, id)) next.graph.nodes.push({ ...node, id, data: rewriteIds(node.data, renames) as Record<string, unknown> | undefined });
  }
  for (const edge of resultFrame.graph.edges) {
    if (baseEdgeKeys.has(edgeKey(edge))) continue;
    const from = renames.get(edge.from) ?? edge.from;
    const to = renames.get(edge.to) ?? edge.to;
    if (hasNode(next.graph, from) && hasNode(next.graph, to)) addEdge(next.graph, from, to, edge.type);
  }
  return next;
}

function addWorkerResultNode(graph: StateGraph, execution: WorkerExecution): GraphNode {
  const { plan, result, error } = execution;
  const node: GraphNode = {
    id: uniqueNodeId(graph.nodes, plan.resultNodeId),
    type: "worker_result",
    text: result?.finalAnswer ?? `Worker ${plan.id} failed: ${error ?? "unknown error"}`,
    data: withoutUndefined({ workerId: plan.id, objective: plan.objective, focusNodeId: plan.focusNodeId, status: result ? "done" : "error", finalAnswer: result?.finalAnswer, error, nodeCount: result?.graph.nodes.length, edgeCount: result?.graph.edges.length }),
    status: result ? "resolved" : "rejected",
    confidence: result ? 1 : 0,
    createdAt: nowIso()
  };
  graph.nodes.push(node);
  return node;
}

function edgeKey(edge: Pick<GraphEdge, "from" | "to" | "type">): string {
  return `${edge.from}\u0000${edge.type}\u0000${edge.to}`;
}

function rewriteIds(value: unknown, renames: Map<string, string>): unknown {
  if (typeof value === "string") return renames.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteIds(item, renames));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteIds(item, renames)]));
}

function safeWorkerId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "worker";
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
