import type { EdgeType, GraphFrame, GraphNode, GraphOp, StateGraph } from "./types.js";
import { nowIso } from "./graph.js";

export function applyOps(frame: GraphFrame, ops: GraphOp[]): GraphFrame {
  const next: GraphFrame = structuredClone(frame);
  const anchor = latestUserInput(next.graph.nodes) ?? next.graph.nodes.find((node) => node.id === "system_root") ?? next.graph.nodes[0];
  const addedNodeIds: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        const existing = next.graph.nodes.find((node) => node.id === op.node.id);
        if (!existing) {
          next.graph.nodes.push({ ...op.node, createdAt: nowIso() });
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
        next.frame.currentFocus = op.currentFocus;
        break;
      case "call_tool":
        break;
      case "final":
        addAssistantOutput(next.graph, op.answer, anchor);
        break;
      default:
        assertNever(op);
    }
  }

  connectNewNodes(next.graph, addedNodeIds, anchor);
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

function addAssistantOutput(graph: StateGraph, answer: string, anchor: GraphNode | undefined): void {
  const id = `assistant_output_${nextIndex(graph.nodes, "assistant_output_")}`;
  if (graph.nodes.some((node) => node.id === id)) return;
  graph.nodes.push({ id, type: "assistant_output", text: answer, status: "resolved", confidence: 1, createdAt: nowIso() });
  if (anchor) addEdge(graph, anchor.id, id, "follows");
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
