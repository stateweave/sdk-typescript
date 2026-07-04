import type { GraphFrame, GraphOp, StateGraph } from "./types.js";
import { nowIso } from "./graph.js";

export function applyOps(frame: GraphFrame, ops: GraphOp[]): GraphFrame {
  const next: GraphFrame = structuredClone(frame);

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        const existing = next.graph.nodes.find((node) => node.id === op.node.id);
        if (!existing) {
          next.graph.nodes.push({ ...op.node, createdAt: nowIso() });
        }
        break;
      }
      case "add_edge": {
        const fromExists = next.graph.nodes.some((node) => node.id === op.from);
        const toExists = next.graph.nodes.some((node) => node.id === op.to);
        if (!fromExists || !toExists) break;
        const id = `edge_${op.from}_${op.type}_${op.to}`.replace(/[^a-zA-Z0-9_]/g, "_");
        if (!next.graph.edges.some((edge) => edge.id === id)) {
          next.graph.edges.push({ id, from: op.from, to: op.to, type: op.type, createdAt: nowIso() });
        }
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

  return next;
}

export function addToolResult(graph: StateGraph, args: { tool: string; result: unknown; step: number }): StateGraph {
  const next = structuredClone(graph);
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
  next.edges.push({
    id: `edge_${resultId}_explains_${callId}`,
    from: resultId,
    to: callId,
    type: "explains",
    createdAt
  });
  return next;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled op: ${JSON.stringify(value)}`);
}
