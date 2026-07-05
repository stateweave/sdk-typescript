import type { EdgeType, GraphFrame, GraphNode, GraphOp, StateGraph } from "./types.js";
import { nowIso } from "./graph.js";

export class GraphOpsValidationError extends Error {
  reasons: string[];

  constructor(reasons: string[]) {
    super(`GraphOps rejected: ${reasons.join(" ")}`);
    this.name = "GraphOpsValidationError";
    this.reasons = reasons;
  }
}

export function applyOps(frame: GraphFrame, ops: GraphOp[]): GraphFrame {
  const next: GraphFrame = structuredClone(frame);
  const preNodeIds = new Set(frame.graph.nodes.map((node) => node.id));
  const declaredNodeIds = new Set(preNodeIds);
  const referenceErrors: string[] = [];

  for (const op of ops) {
    if (op.op === "add_node") declaredNodeIds.add(op.node.id);
  }

  const anchor = activeUserInput(next) ?? focusedNode(next) ?? latestUserInput(next.graph.nodes) ?? next.graph.nodes.find((node) => node.id === "system_root") ?? next.graph.nodes[0];

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        const existing = next.graph.nodes.find((node) => node.id === op.node.id);
        if (!existing) next.graph.nodes.push({ ...op.node, createdAt: nowIso() });
        break;
      }
      case "add_edge": {
        if (!declaredNodeIds.has(op.from) || !declaredNodeIds.has(op.to)) {
          referenceErrors.push(`edge ${op.from} ${op.type} ${op.to} references a missing node`);
          break;
        }
        addEdge(next.graph, op.from, op.to, op.type);
        break;
      }
      case "update_node": {
        if (!declaredNodeIds.has(op.id)) {
          referenceErrors.push(`update ${op.id} references a missing node`);
          break;
        }
        const node = next.graph.nodes.find((item) => item.id === op.id);
        if (node) Object.assign(node, { ...op.patch, id: node.id, createdAt: node.createdAt });
        break;
      }
      case "focus": {
        if (op.nodeId && !declaredNodeIds.has(op.nodeId)) {
          referenceErrors.push(`focus ${op.nodeId} references a missing node`);
          break;
        }
        applyFocus(next, op);
        break;
      }
      case "call_tool":
        break;
      case "spawn_worker":
        if (op.focusNodeId && !declaredNodeIds.has(op.focusNodeId)) referenceErrors.push(`worker ${op.id} focus ${op.focusNodeId} references a missing node`);
        break;
      case "final": {
        const artifactIds = finalArtifactIds(op);
        for (const artifactId of artifactIds) {
          if (!declaredNodeIds.has(artifactId)) referenceErrors.push(`final artifact ${artifactId} references a missing node`);
        }
        if (artifactIds.some((artifactId) => !declaredNodeIds.has(artifactId))) break;
        const assistant = addAssistantOutput(next.graph, op.answer, anchor, preNodeIds, artifactIds);
        next.frame.focusNodeId = assistant.id;
        next.frame.activeUserInputNodeId = userInputIdForNode(next.graph, assistant) ?? next.frame.latestInputNodeId ?? next.frame.activeUserInputNodeId;
        next.frame.currentFocus = `Cortex focus is ${assistant.id}; continue from this answer unless the next user input asks for a fresh context or another focus.`;
        break;
      }
      default:
        assertNever(op);
    }
  }

  validateGraphTransaction(frame, next, referenceErrors);
  delete next.frame.lastGraphOpsError;
  next.frame.candidateFocusNodeIds = candidateFocusNodeIds(next);
  return next;
}

export function addToolResult(graph: StateGraph, args: { tool: string; result: unknown; step: number }): StateGraph {
  const next = structuredClone(graph);
  const anchor = latestUserInput(next.nodes) ?? next.nodes.find((node) => node.id === "system_root") ?? next.nodes[0];
  const callId = `tool_call_${args.step}_${next.nodes.length}`;
  const resultId = `tool_result_${args.step}_${next.nodes.length + 1}`;
  const createdAt = nowIso();
  next.nodes.push(
    {
      id: callId,
      type: "tool_call",
      text: `Called ${args.tool}`,
      data: { tool: args.tool },
      status: "resolved",
      createdAt
    },
    {
      id: resultId,
      type: "tool_result",
      text: typeof args.result === "string" ? args.result : JSON.stringify(args.result),
      data: { tool: args.tool, result: args.result },
      status: "active",
      confidence: 1,
      createdAt
    }
  );
  if (anchor) addEdge(next, anchor.id, callId, "relates_to");
  addEdge(next, resultId, callId, "explains");
  return next;
}

function activeUserInput(frame: GraphFrame): GraphNode | undefined {
  const id = frame.frame.activeUserInputNodeId;
  return id ? frame.graph.nodes.find((node) => node.id === id && node.type === "user_input") : undefined;
}

function addAssistantOutput(graph: StateGraph, answer: string, anchor: GraphNode | undefined, preNodeIds: Set<string>, artifactIds: string[] = []): GraphNode {
  const existing = graph.nodes.find((node): node is GraphNode => node.type === "assistant_output" && !preNodeIds.has(node.id));
  const ids = unique(artifactIds);
  const data = ids.length ? { artifactId: ids[0], artifactIds: ids } : undefined;

  if (existing) {
    existing.text = answer;
    existing.data = data ? { ...existing.data, ...data } : existing.data;
    existing.status = "resolved";
    existing.confidence = existing.confidence ?? 1;
    if (anchor && !isReferenced(graph, existing.id)) addEdge(graph, anchor.id, existing.id, "follows");
    for (const artifactId of ids) if (graph.nodes.some((node) => node.id === artifactId)) addEdge(graph, existing.id, artifactId, "creates");
    return existing;
  }

  const id = `assistant_output_${nextIndex(graph.nodes, "assistant_output_")}`;
  const node: GraphNode = { id, type: "assistant_output", text: answer, data, status: "resolved", confidence: 1, createdAt: nowIso() };
  graph.nodes.push(node);
  if (anchor) addEdge(graph, anchor.id, id, "follows");
  for (const artifactId of ids) if (graph.nodes.some((item) => item.id === artifactId)) addEdge(graph, id, artifactId, "creates");
  return node;
}

function finalArtifactIds(op: Extract<GraphOp, { op: "final" }>): string[] {
  return unique([...(op.artifactIds ?? []), ...(op.artifactId ? [op.artifactId] : [])]);
}

function validateGraphTransaction(frameBefore: GraphFrame, frameAfter: GraphFrame, referenceErrors: string[]): void {
  const errors = [...referenceErrors];
  const preNodeIds = new Set(frameBefore.graph.nodes.map((node) => node.id));
  const newNodeIds = frameAfter.graph.nodes.filter((node) => !preNodeIds.has(node.id)).map((node) => node.id);
  const latestInputId = frameBefore.frame.latestInputNodeId;
  const pendingInputIds = latestInputId && frameAfter.graph.nodes.some((node) => node.id === latestInputId && node.type === "user_input") ? [latestInputId] : [];
  const requiredConnectedIds = unique([...newNodeIds, ...pendingInputIds]);

  if (requiredConnectedIds.length) {
    const fallbackAnchorIds = frameBefore.graph.nodes.map((node) => node.id).filter((id) => !requiredConnectedIds.includes(id));
    const anchorIds = new Set(frameAfter.graph.nodes.some((node) => node.id === "system_root") ? ["system_root"] : fallbackAnchorIds);
    const connectedIds = connectedComponent(frameAfter.graph, anchorIds);

    for (const id of requiredConnectedIds) {
      if (connectedIds.has(id)) continue;
      if (id === latestInputId) {
        errors.push(`pending latest user input ${id} is disconnected from the existing graph; attach it with @edge system_root follows ${id} for a fresh request or connect it to the relevant prior node`);
      } else {
        const anchorHint = latestInputId && frameAfter.graph.nodes.some((node) => node.id === latestInputId) ? latestInputId : "an existing node";
        errors.push(`new node ${id} is disconnected from the existing graph; attach it with an @edge from ${anchorHint} or another connected node`);
      }
    }
  }

  if (errors.length) throw new GraphOpsValidationError(errors);
}

function connectedComponent(graph: StateGraph, anchorIds: Set<string>): Set<string> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const connected = new Set<string>();
  const queue = [...anchorIds].filter((id) => ids.has(id));
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  while (queue.length) {
    const id = queue.shift();
    if (!id || connected.has(id)) continue;
    connected.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!connected.has(next)) queue.push(next);
    }
  }

  return connected;
}

function latestUserInput(nodes: GraphNode[]): GraphNode | undefined {
  return [...nodes].reverse().find((node) => node.type === "user_input");
}

function focusedNode(frame: GraphFrame): GraphNode | undefined {
  return frame.frame.focusNodeId ? frame.graph.nodes.find((node) => node.id === frame.frame.focusNodeId) : undefined;
}

function applyFocus(frame: GraphFrame, op: Extract<GraphOp, { op: "focus" }>): void {
  frame.frame.currentFocus = op.currentFocus;
  const nodeId = op.nodeId ?? (frame.graph.nodes.some((node) => node.id === op.currentFocus) ? op.currentFocus : undefined);
  if (!nodeId) return;

  const node = frame.graph.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  frame.frame.focusNodeId = node.id;
  frame.frame.activeUserInputNodeId = userInputIdForNode(frame.graph, node) ?? frame.frame.activeUserInputNodeId;
}

function userInputIdForNode(graph: StateGraph, node: GraphNode | undefined): string | undefined {
  if (!node || node.type === "system") return undefined;
  if (node.type === "user_input") return node.id;

  const visited = new Set<string>();
  const queue = [node.id];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const currentNode = graph.nodes.find((item) => item.id === current);
    if (currentNode?.type === "user_input") return currentNode.id;
    for (const edge of graph.edges.filter((item) => item.to === current)) queue.push(edge.from);
  }
  return undefined;
}

function candidateFocusNodeIds(frame: GraphFrame): string[] {
  return unique([
    "system_root",
    frame.frame.activeUserInputNodeId,
    frame.frame.latestInputNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.filter((node) => node.type === "user_input").map((node) => node.id)
  ].filter((id): id is string => Boolean(id) && frame.graph.nodes.some((node) => node.id === id)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nextIndex(nodes: GraphNode[], prefix: string): number {
  return nodes.filter((node) => node.id.startsWith(prefix)).length + 1;
}

function isReferenced(graph: StateGraph, nodeId: string): boolean {
  return graph.edges.some((edge) => edge.from === nodeId || edge.to === nodeId);
}

function addEdge(graph: StateGraph, from: string, to: string, type: EdgeType): void {
  const id = `edge_${from}_${type}_${to}`.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!graph.edges.some((edge) => edge.id === id)) graph.edges.push({ id, from, to, type, createdAt: nowIso() });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled op: ${JSON.stringify(value)}`);
}
