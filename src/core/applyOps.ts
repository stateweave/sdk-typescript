import type { EdgeType, GraphFrame, GraphNode, GraphOp, StateGraph } from "./types.js";
import { nowIso } from "./graph.js";

export function applyOps(frame: GraphFrame, ops: GraphOp[]): GraphFrame {
  const next: GraphFrame = structuredClone(frame);
  const anchor = latestUserInput(next.graph.nodes) ?? focusedNode(next) ?? next.graph.nodes.find((node) => node.id === "system_root") ?? next.graph.nodes[0];
  const anchorBranchId = branchIdForNode(next.graph, anchor) ?? next.frame.activeBranchNodeId;
  const addedNodeIds: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        const existing = next.graph.nodes.find((node) => node.id === op.node.id);
        if (!existing) {
          next.graph.nodes.push({ ...op.node, data: inheritBranchData(op.node, anchorBranchId), createdAt: nowIso() });
          addedNodeIds.push(op.node.id);
        }
        break;
      }
      case "add_edge": {
        const fromExists = next.graph.nodes.some((node) => node.id === op.from);
        const toExists = next.graph.nodes.some((node) => node.id === op.to);
        if (!fromExists || !toExists) break;
        addEdge(next.graph, op.from, op.to, op.type);
        break;
      }
      case "update_node": {
        const node = next.graph.nodes.find((item) => item.id === op.id);
        if (node) Object.assign(node, { ...op.patch, id: node.id, createdAt: node.createdAt });
        break;
      }
      case "focus":
        applyFocus(next, op);
        break;
      case "call_tool":
        break;
      case "final": {
        const assistant = addAssistantOutput(next.graph, op.answer, anchor, addedNodeIds, op.artifactId);
        next.frame.focusNodeId = assistant.id;
        next.frame.activeBranchNodeId = branchIdForNode(next.graph, assistant) ?? next.frame.activeBranchNodeId ?? "system_root";
        next.frame.currentFocus = `Cortex focus is ${assistant.id}; continue this branch unless the next user input asks to branch, merge, or refocus.`;
        break;
      }
      default:
        assertNever(op);
    }
  }

  connectNewNodes(next.graph, addedNodeIds, anchor);
  next.frame.candidateBranchNodeIds = candidateBranchNodeIds(next);
  return next;
}

export function addToolResult(graph: StateGraph, args: { tool: string; result: unknown; step: number }): StateGraph {
  const next = structuredClone(graph);
  const anchor = latestUserInput(next.nodes) ?? next.nodes.find((node) => node.id === "system_root") ?? next.nodes[0];
  const branchId = branchIdForNode(next, anchor);
  const branchData = branchId && branchId !== "system_root" ? { branchId } : {};
  const callId = `tool_call_${args.step}_${next.nodes.length}`;
  const resultId = `tool_result_${args.step}_${next.nodes.length + 1}`;
  const createdAt = nowIso();
  next.nodes.push(
    {
      id: callId,
      type: "tool_call",
      text: `Called ${args.tool}`,
      data: { tool: args.tool, ...branchData },
      status: "resolved",
      createdAt
    },
    {
      id: resultId,
      type: "tool_result",
      text: typeof args.result === "string" ? args.result : JSON.stringify(args.result),
      data: { tool: args.tool, result: args.result, ...branchData },
      status: "active",
      confidence: 1,
      createdAt
    }
  );
  if (anchor) addEdge(next, anchor.id, callId, "relates_to");
  addEdge(next, resultId, callId, "explains");
  return next;
}

function addAssistantOutput(graph: StateGraph, answer: string, anchor: GraphNode | undefined, addedNodeIds: string[], artifactId?: string): GraphNode {
  const existing = addedNodeIds.map((id) => graph.nodes.find((node) => node.id === id)).find((node): node is GraphNode => node?.type === "assistant_output");
  const text = artifactId ? `Returned artifact ${artifactId}` : answer;
  const data = artifactId ? { artifactId } : undefined;

  if (existing) {
    existing.text = text;
    existing.data = inheritBranchData({ data: data ? { ...existing.data, ...data } : existing.data }, branchIdForNode(graph, anchor));
    existing.status = "resolved";
    existing.confidence = existing.confidence ?? 1;
    if (anchor && !isReferenced(graph, existing.id)) addEdge(graph, anchor.id, existing.id, "follows");
    if (artifactId && graph.nodes.some((node) => node.id === artifactId)) addEdge(graph, existing.id, artifactId, "creates");
    return existing;
  }

  const id = `assistant_output_${nextIndex(graph.nodes, "assistant_output_")}`;
  const node: GraphNode = { id, type: "assistant_output", text, data: inheritBranchData({ data }, branchIdForNode(graph, anchor)), status: "resolved", confidence: 1, createdAt: nowIso() };
  graph.nodes.push(node);
  if (anchor) addEdge(graph, anchor.id, id, "follows");
  if (artifactId && graph.nodes.some((item) => item.id === artifactId)) addEdge(graph, id, artifactId, "creates");
  return node;
}

function connectNewNodes(graph: StateGraph, ids: string[], anchor: GraphNode | undefined): void {
  if (!anchor) return;

  for (const id of ids) {
    if (id === anchor.id || isReferenced(graph, id)) continue;
    addEdge(graph, anchor.id, id, "relates_to");
  }
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
  frame.frame.activeBranchNodeId = node.type === "branch" || node.type === "system" ? node.id : branchIdForNode(frame.graph, node) ?? frame.frame.activeBranchNodeId ?? "system_root";
}

function inheritBranchData(node: { type?: string; data?: Record<string, unknown> }, branchId: string | undefined): Record<string, unknown> | undefined {
  if (!branchId || branchId === "system_root" || node.type === "branch") return node.data;
  const existing = node.data ?? {};
  return typeof existing.branchId === "string" ? existing : { ...existing, branchId };
}

function branchIdForNode(graph: StateGraph, node: GraphNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "branch" || node.type === "system") return node.id;
  if (typeof node.data?.branchId === "string") return node.data.branchId;

  const visited = new Set<string>();
  const queue = [node.id];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const currentNode = graph.nodes.find((item) => item.id === current);
    if (currentNode?.type === "branch" || currentNode?.type === "system") return currentNode.id;
    if (typeof currentNode?.data?.branchId === "string") return currentNode.data.branchId;
    for (const edge of graph.edges.filter((item) => item.to === current)) queue.push(edge.from);
  }
  return undefined;
}

function candidateBranchNodeIds(frame: GraphFrame): string[] {
  return unique([
    "system_root",
    frame.frame.activeBranchNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.filter((node) => node.type === "branch" && node.status !== "rejected").map((node) => node.id)
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
