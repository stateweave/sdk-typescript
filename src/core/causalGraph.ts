import type { CausalNodeKind, CausalWeaveSnapshot } from "./causalTypes.js";
import type { GraphNode, StateGraph } from "./types.js";

export function agentStateToGraph(state?: CausalWeaveSnapshot): StateGraph {
  if (!state) return { nodes: [], edges: [] };
  return {
    nodes: state.nodes.map((node) => ({
      id: node.id,
      type: graphNodeType(node.kind),
      text: payloadText(node.payload),
      data: { kind: node.kind, parents: node.parents, sequence: node.sequence, ...(node.resourceKey ? { resourceKey: node.resourceKey } : {}) },
      status: state.frontier.includes(node.id) ? "active" : "resolved",
      createdAt: node.createdAt
    })),
    edges: state.nodes.flatMap((node) => node.parents.map((parent, index) => ({
      id: `edge_${parent}_${node.id}_${index}`,
      from: parent,
      to: node.id,
      type: node.kind === "goal" || node.kind === "answer" ? "follows" as const : "causes" as const,
      createdAt: node.createdAt
    })))
  };
}

function graphNodeType(kind: CausalNodeKind): GraphNode["type"] {
  if (kind === "system") return "system";
  if (kind === "goal") return "user_input";
  if (kind === "answer") return "assistant_output";
  return kind;
}

function payloadText(payload: unknown): string {
  let value: string;
  if (typeof payload === "string") value = payload;
  else {
    try { value = JSON.stringify(payload); } catch { value = String(payload); }
  }
  return value.length <= 2_000 ? value : `${value.slice(0, 2_000)}…[${value.length - 2_000} chars omitted]`;
}
