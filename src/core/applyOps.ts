import type { EdgeType, GraphFrame, GraphNode, GraphOp, StateGraph } from "./types.js";
import { forkFrame, nowIso } from "./graph.js";
import { addEdge, isReferenced, nextSequenceId, turnTask, unique } from "./graphEdit.js";

export { addToolResult } from "./toolEvidence.js";

export class GraphOpsValidationError extends Error {
  reasons: string[];

  constructor(reasons: string[]) {
    super(`GraphOps rejected: ${reasons.join(" ")}`);
    this.name = "GraphOpsValidationError";
    this.reasons = reasons;
  }
}

type Transaction = { next: GraphFrame; preNodeIds: Set<string>; declared: Set<string>; errors: string[]; anchor?: GraphNode };
type OpHandler<K extends GraphOp["op"]> = (op: Extract<GraphOp, { op: K }>, tx: Transaction) => void;

export function applyOps(frame: GraphFrame, ops: GraphOp[]): GraphFrame {
  const next = forkFrame(frame);
  const preNodeIds = new Set(frame.graph.nodes.map((node) => node.id));
  const tx: Transaction = { next, preNodeIds, declared: new Set(preNodeIds), errors: [], anchor: transactionAnchor(next) };
  declareNodes(ops, tx);
  for (const op of ops) (handlers[op.op] as OpHandler<typeof op.op>)(op as never, tx);
  autoConnectTransaction(frame, next, preNodeIds);
  validateGraphTransaction(frame, next, tx.errors);
  delete next.frame.lastGraphOpsError;
  next.frame.candidateFocusNodeIds = candidateFocusNodeIds(next);
  return next;
}

function declareNodes(ops: GraphOp[], tx: Transaction): void {
  const added = new Set<string>();
  for (const op of ops) {
    if (op.op !== "add_node") continue;
    if (tx.preNodeIds.has(op.node.id)) tx.errors.push(`add_node ${op.node.id} collides with an existing node`);
    if (added.has(op.node.id)) tx.errors.push(`add_node ${op.node.id} is declared more than once in the transaction`);
    added.add(op.node.id);
    tx.declared.add(op.node.id);
  }
}

const handlers: { [K in GraphOp["op"]]: OpHandler<K> } = {
  add_node: (op, tx) => {
    if (!tx.preNodeIds.has(op.node.id) && !tx.next.graph.nodes.some((node) => node.id === op.node.id)) tx.next.graph.nodes.push({ ...op.node, createdAt: nowIso() });
  },
  add_edge: (op, tx) => {
    if (requireNodes(tx, [op.from, op.to], `edge ${op.from} ${op.type} ${op.to} references a missing node`)) addEdge(tx.next.graph, op.from, op.to, op.type);
  },
  update_node: (op, tx) => {
    if (!requireNodes(tx, [op.id], `update ${op.id} references a missing node`)) return;
    const node = tx.next.graph.nodes.find((item) => item.id === op.id);
    if (node) Object.assign(node, { ...op.patch, id: node.id, createdAt: node.createdAt });
  },
  focus: (op, tx) => {
    if (!op.nodeId || requireNodes(tx, [op.nodeId], `focus ${op.nodeId} references a missing node`)) applyFocus(tx.next, op);
  },
  zoom: (op, tx) => {
    tx.next.frame.zoom = op.level;
  },
  call_tool: () => undefined,
  spawn_worker: (op, tx) => {
    if (op.focusNodeId) requireNodes(tx, [op.focusNodeId], `worker ${op.id} focus ${op.focusNodeId} references a missing node`);
  },
  final: (op, tx) => {
    const artifactIds = unique([...(op.artifactIds ?? []), ...(op.artifactId ? [op.artifactId] : [])]);
    const missing = artifactIds.filter((id) => !tx.declared.has(id));
    for (const id of missing) tx.errors.push(`final artifact ${id} references a missing node`);
    if (missing.length) return;
    const task = resolveTurnTask(tx.next);
    const assistant = addAssistantOutput(tx.next.graph, op.answer, task ?? tx.anchor, tx.preNodeIds, artifactIds);
    tx.next.frame.focusNodeId = assistant.id;
    tx.next.frame.activeUserInputNodeId = userInputIdForNode(tx.next.graph, assistant) ?? tx.next.frame.latestInputNodeId ?? tx.next.frame.activeUserInputNodeId;
    tx.next.frame.currentFocus = assistant.id;
  }
};

function requireNodes(tx: Transaction, ids: string[], message: string): boolean {
  if (ids.every((id) => tx.declared.has(id))) return true;
  tx.errors.push(message);
  return false;
}

function transactionAnchor(frame: GraphFrame): GraphNode | undefined {
  const byId = (id: string | undefined) => (id ? frame.graph.nodes.find((node) => node.id === id) : undefined);
  const activeInput = byId(frame.frame.activeUserInputNodeId);
  return (activeInput?.type === "user_input" ? activeInput : undefined)
    ?? byId(frame.frame.focusNodeId)
    ?? [...frame.graph.nodes].reverse().find((node) => node.type === "user_input")
    ?? byId("system_root")
    ?? frame.graph.nodes[0];
}

/** The final answer completes the turn: the runtime resolves the turn's task and links final → task. */
function resolveTurnTask(frame: GraphFrame): GraphNode | undefined {
  const task = turnTask(frame.graph, frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId);
  if (task && task.status !== "resolved") task.status = "resolved";
  return task;
}

/** Runtime-derived structure: new tasks hang off the input via `addresses`; other loose nodes via `relates_to`. */
function autoConnectTransaction(frameBefore: GraphFrame, frameAfter: GraphFrame, preNodeIds: Set<string>): void {
  const graph = frameAfter.graph;
  const root = graph.nodes.find((node) => node.id === "system_root") ?? graph.nodes[0];
  const latestInputId = frameBefore.frame.latestInputNodeId;
  if (root && latestInputId && !graph.edges.some((edge) => edge.from === root.id && edge.to === latestInputId)) addEdge(graph, root.id, latestInputId, "follows");
  const anchor = (latestInputId && graph.nodes.find((node) => node.id === latestInputId)) || root;
  if (!anchor) return;
  for (const node of graph.nodes) {
    if (preNodeIds.has(node.id) || node.id === anchor.id || isReferenced(graph, node.id)) continue;
    addEdge(graph, anchor.id, node.id, autoEdgeType(node));
  }
}

function autoEdgeType(node: GraphNode): EdgeType {
  if (node.type === "assistant_output") return "follows";
  return node.type === "task" ? "addresses" : "relates_to";
}

function addAssistantOutput(graph: StateGraph, answer: string, anchor: GraphNode | undefined, preNodeIds: Set<string>, artifactIds: string[]): GraphNode {
  const data = artifactIds.length ? { artifactId: artifactIds[0], artifactIds } : undefined;
  let node = graph.nodes.find((item) => item.type === "assistant_output" && !preNodeIds.has(item.id));
  if (node) {
    Object.assign(node, { text: answer, data: data ? { ...node.data, ...data } : node.data, status: "resolved", confidence: node.confidence ?? 1 });
  } else {
    node = { id: nextSequenceId(graph.nodes, "assistant_output_"), type: "assistant_output", text: answer, data, status: "resolved", confidence: 1, createdAt: nowIso() };
    graph.nodes.push(node);
  }
  if (anchor && !graph.edges.some((edge) => edge.to === node.id && edge.type === "follows")) addEdge(graph, anchor.id, node.id, "follows");
  for (const id of artifactIds) if (graph.nodes.some((item) => item.id === id)) addEdge(graph, node.id, id, "creates");
  return node;
}

function validateGraphTransaction(frameBefore: GraphFrame, frameAfter: GraphFrame, referenceErrors: string[]): void {
  const errors = [...referenceErrors];
  const preNodeIds = new Set(frameBefore.graph.nodes.map((node) => node.id));
  const latestInputId = frameBefore.frame.latestInputNodeId;
  const pendingInputIds = latestInputId && frameAfter.graph.nodes.some((node) => node.id === latestInputId && node.type === "user_input") ? [latestInputId] : [];
  const required = unique([...frameAfter.graph.nodes.filter((node) => !preNodeIds.has(node.id)).map((node) => node.id), ...pendingInputIds]);
  if (required.length) {
    const anchorIds = frameAfter.graph.nodes.some((node) => node.id === "system_root") ? ["system_root"] : [...preNodeIds].filter((id) => !required.includes(id));
    const connected = connectedComponent(frameAfter.graph, anchorIds);
    for (const id of required.filter((item) => !connected.has(item))) errors.push(disconnectedMessage(id, latestInputId, frameAfter));
  }
  if (errors.length) throw new GraphOpsValidationError(errors);
}

function disconnectedMessage(id: string, latestInputId: string | undefined, frame: GraphFrame): string {
  if (id === latestInputId) return `pending latest user input ${id} is disconnected from the existing graph; attach it with E system_root follows ${id} for a fresh request or connect it to the relevant prior node`;
  const hint = latestInputId && frame.graph.nodes.some((node) => node.id === latestInputId) ? latestInputId : "an existing node";
  return `new node ${id} is disconnected from the existing graph; attach it with E ${hint} <edge_type> ${id} or from another connected node`;
}

function connectedComponent(graph: StateGraph, anchorIds: string[]): Set<string> {
  const adjacency = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  const connected = new Set<string>();
  const queue = anchorIds.filter((id) => adjacency.has(id));
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (connected.has(id)) continue;
    connected.add(id);
    queue.push(...(adjacency.get(id) ?? []).filter((item) => !connected.has(item)));
  }
  return connected;
}

function applyFocus(frame: GraphFrame, op: Extract<GraphOp, { op: "focus" }>): void {
  frame.frame.currentFocus = op.currentFocus;
  const nodeId = op.nodeId ?? op.currentFocus;
  const node = frame.graph.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  frame.frame.focusNodeId = node.id;
  frame.frame.activeUserInputNodeId = userInputIdForNode(frame.graph, node) ?? frame.frame.activeUserInputNodeId;
}

function userInputIdForNode(graph: StateGraph, node: GraphNode): string | undefined {
  if (node.type === "system") return undefined;
  const visited = new Set<string>();
  const queue = [node.id];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (visited.has(current)) continue;
    visited.add(current);
    if (graph.nodes.find((item) => item.id === current)?.type === "user_input") return current;
    queue.push(...graph.edges.filter((edge) => edge.to === current).map((edge) => edge.from));
  }
  return undefined;
}

function candidateFocusNodeIds(frame: GraphFrame): string[] {
  const ids = [
    "system_root",
    frame.frame.activeUserInputNodeId,
    frame.frame.latestInputNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.filter((node) => node.type === "user_input").slice(-12).map((node) => node.id)
  ];
  return unique(ids.filter((id): id is string => Boolean(id) && frame.graph.nodes.some((node) => node.id === id)));
}
