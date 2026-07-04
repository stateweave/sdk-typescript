import type { StateGraph } from "./types.js";

export function graphToMermaid(graph: StateGraph): string {
  const lines = ["flowchart LR"];

  for (const node of graph.nodes) {
    lines.push(`  ${safeId(node.id)}["${escapeLabel(`${node.id}\n${node.type}: ${node.text}`)}"]`);
  }

  for (const edge of graph.edges) {
    lines.push(`  ${safeId(edge.from)} -- "${edge.type}" --> ${safeId(edge.to)}`);
  }

  if (lines.length === 1) lines.push("  empty[\"empty graph\"]");
  return lines.join("\n");
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\n/g, "<br/>");
}
