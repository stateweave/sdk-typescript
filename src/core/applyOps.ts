import type { GraphFrame, GraphNode, GraphOp, StateGraph } from "./types.js";
import { nowIso } from "./graph.js";

export function applyOps(frame: GraphFrame, ops: GraphOp[]): GraphFrame {
  const next: GraphFrame = structuredClone(frame);
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
      case "final":
        break;
      default:
        assertNever(op);
    }
  }

  connectNewNodes(next.graph, addedNodeIds);
  return next;
}

export function addToolResult(graph: StateGraph, args: { tool: string; result: unknown; step: number }): StateGraph {
  const next = structuredClone(graph);
  const anchor = latestIntent(next.nodes);
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

function connectNewNodes(graph: StateGraph, ids: string[]): void {
  const anchor = latestIntent(graph.nodes) ?? graph.nodes[0];
  if (!anchor) return;

  for (const id of ids) {
    if (id === anchor.id || isReferenced(graph, id)) continue;
    addEdge(graph, anchor.id, id, "relates_to");
  }
}

function latestIntent(nodes: GraphNode[]): GraphNode | undefined {
  return [...nodes].reverse().find((node) => node.type === "intent");
}

function isReferenced(graph: StateGraph, nodeId: string): boolean {
  return graph.edges.some((edge) => edge.from === nodeId || edge.to === nodeId);
}

function addEdge(graph: StateGraph, from: string, to: string, type: StateGraph["edges"][number]["type"]): void {
  const createdAt = nowIso();
  const id = `edge_${from}_${type}_${to}`.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!graph.edges.some((edge) => edge.id === id)) graph.edges.push({ id, from, to, type, createdAt });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled op: ${JSON.stringify(value)}`);
}
