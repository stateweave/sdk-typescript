// Internal graph-editing helpers shared by the transaction, evidence, and worker layers.
import type { EdgeType, GraphNode, StateGraph } from "./types.js";

export function nextSequenceId(nodes: GraphNode[], prefix: string): string {
  let next = nodes.reduce((max, node) => {
    const rest = node.id.startsWith(prefix) ? node.id.slice(prefix.length) : "";
    return /^\d+$/.test(rest) ? Math.max(max, Number(rest)) : max;
  }, 0) + 1;
  while (nodes.some((node) => node.id === `${prefix}${next}`)) next += 1;
  return `${prefix}${next}`;
}

export function uniqueNodeId(nodes: GraphNode[], base: string): string {
  if (!nodes.some((node) => node.id === base)) return base;
  let suffix = 2;
  while (nodes.some((node) => node.id === `${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** Adds an edge once per (from, type, to); ids are sanitized and made unique. */
export function addEdge(graph: StateGraph, from: string, to: string, type: EdgeType): void {
  if (graph.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type)) return;
  const base = `edge_${from}_${type}_${to}`.replace(/[^a-zA-Z0-9_]/g, "_");
  let id = base;
  for (let suffix = 2; graph.edges.some((edge) => edge.id === id); suffix++) id = `${base}_${suffix}`;
  graph.edges.push({ id, from, to, type, createdAt: new Date().toISOString() });
}

export function hasNode(graph: StateGraph, id: string): boolean {
  return graph.nodes.some((node) => node.id === id);
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function isReferenced(graph: StateGraph, nodeId: string): boolean {
  return graph.edges.some((edge) => edge.from === nodeId || edge.to === nodeId);
}

function linked(graph: StateGraph, a: string, b: string): boolean {
  return graph.edges.some((edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a));
}

/** Most recent non-rejected task node connected to the active (or latest) user input. */
export function turnTask(graph: StateGraph, inputId: string | undefined): GraphNode | undefined {
  if (!inputId) return undefined;
  return [...graph.nodes].reverse().find((node) => node.type === "task" && node.status !== "rejected" && node.status !== "stale" && linked(graph, inputId, node.id));
}

/** Active canonical file-state node for a path, written by successful read/write/edit evidence. */
export function activeFileState(graph: StateGraph, path: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.type === "file" && node.status === "active" && node.data?.canonical === true && node.data?.path === path);
}
