import type { CausalNodeKind, CausalWeaveSnapshot } from "./causalTypes.js";
import type { GraphNode, StateGraph } from "./types.js";

export function agentStateToGraph(state?: CausalWeaveSnapshot): StateGraph {
  if (!state) return { nodes: [], edges: [] };
  const molecules = causalMolecules(state);
  return {
    nodes: state.nodes.map((node) => ({
      id: node.id,
      type: graphNodeType(node.kind, node.payload),
      text: node.kind === "semantic" ? semanticContentText(node.payload) : payloadText(node.payload),
      data: { kind: node.kind, parents: node.parents, sequence: node.sequence, moleculeId: molecules.get(node.id)?.id, moleculeLabel: molecules.get(node.id)?.label, moleculeSequence: molecules.get(node.id)?.sequence, ...(node.kind === "semantic" ? { semanticType: semanticType(node.payload) } : {}), ...(node.resourceKey ? { resourceKey: node.resourceKey } : {}) },
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

function causalMolecules(state: CausalWeaveSnapshot): Map<string, { id: string; label: string; sequence: number }> {
  const assignments = new Map<string, { id: string; label: string; sequence: number }>();
  const system = { id: "molecule_system", label: "Memory root", sequence: 0 };
  for (const node of state.nodes) {
    if (node.kind === "system") {
      assignments.set(node.id, system);
      continue;
    }
    if (node.kind === "goal") {
      assignments.set(node.id, { id: `molecule_${node.id}`, label: payloadText(node.payload).slice(0, 96) || `Turn ${node.sequence}`, sequence: node.sequence });
      continue;
    }
    const inherited = node.parents
      .map((parent) => assignments.get(parent))
      .filter((candidate): candidate is { id: string; label: string; sequence: number } => Boolean(candidate))
      .sort((a, b) => b.sequence - a.sequence)[0];
    assignments.set(node.id, inherited ?? system);
  }
  return assignments;
}

function graphNodeType(kind: CausalNodeKind, payload: unknown): GraphNode["type"] {
  if (kind === "system") return "system";
  if (kind === "goal") return "user_input";
  if (kind === "answer") return "assistant_output";
  if (kind === "semantic") return semanticType(payload) || "memory";
  return kind;
}

function semanticType(payload: unknown): string {
  return payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).type === "string"
    ? (payload as Record<string, unknown>).type as string
    : "";
}

function semanticContentText(payload: unknown): string {
  return payload && typeof payload === "object" && "content" in payload
    ? payloadText((payload as Record<string, unknown>).content)
    : payloadText(payload);
}

function payloadText(payload: unknown): string {
  let value: string;
  if (typeof payload === "string") value = payload;
  else {
    try { value = JSON.stringify(payload); } catch { value = String(payload); }
  }
  return value.length <= 2_000 ? value : `${value.slice(0, 2_000)}…[${value.length - 2_000} chars omitted]`;
}
