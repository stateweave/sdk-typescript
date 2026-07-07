import type { GraphNode, StateGraph } from "./types.js";

// Peripheral Vision: the StateGraph is append-only ground truth that is never
// compacted. The projection is a disposable, bounded, multi-resolution VIEW of
// that graph. The model always sees a big-brain overview (the map), a periphery
// of nearby topics, and a detailed focus window for the active region.

export type ProjectionFocus = {
  focusNodeId?: string;
  zoom?: number;
  radius?: number;
  budgetNodes?: number;
};

export type Cluster = {
  id: string;
  seedId: string;
  nodeIds: string[];
  label: string;
  summary: string;
  nodeCount: number;
  edgeCount: number;
};

export type Projection = {
  focusNodes: GraphNode[];
  focusEdgeLines: string[];
  peripheralClusters: Cluster[];
  bigBrainClusters: Cluster[];
  focusClusterIds: string[];
};

const DEFAULT_RADIUS = 4;
const DEFAULT_BUDGET = 48;

export function clusterGraph(graph: StateGraph): Cluster[] {
  const nodes = graph.nodes;
  if (!nodes.length) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = undirectedAdjacency(graph);
  const seeds = nodes
    .filter((node) => node.type === "user_input")
    .sort(byCreatedAt);

  const assignment = new Map<string, string>();

  if (seeds.length) {
    assignToNearestSeed(graph, seeds, adjacency, assignment);
  }

  for (const node of nodes) {
    if (assignment.has(node.id)) continue;
    const component = connectedComponent(graph, node.id, adjacency);
    const seed = [...component]
      .map((id) => byId.get(id))
      .filter((node): node is GraphNode => Boolean(node))
      .sort(byCreatedAt)[0];
    const seedId = seed?.id ?? node.id;
    for (const id of component) assignment.set(id, seedId);
  }

  const buckets = new Map<string, string[]>();
  for (const [nodeId, seedId] of assignment) {
    const bucket = buckets.get(seedId) ?? [];
    bucket.push(nodeId);
    buckets.set(seedId, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => createdAtOf(byId.get(a[0])) - createdAtOf(byId.get(b[0])))
    .map(([seedId, nodeIds]) => buildCluster(graph, seedId, nodeIds.sort((a, b) => createdAtOf(byId.get(a)) - createdAtOf(byId.get(b))), byId));
}

function assignToNearestSeed(
  graph: StateGraph,
  seeds: GraphNode[],
  adjacency: Map<string, string[]>,
  assignment: Map<string, string>
): void {
  const seedRank = new Map<string, number>();
  seeds.forEach((seed, index) => seedRank.set(seed.id, index));

  const queue: Array<{ id: string; dist: number; seed: string; seedRank: number }> = [];
  const bestDist = new Map<string, number>();
  const bestRank = new Map<string, number>();

  for (const seed of seeds) {
    queue.push({ id: seed.id, dist: 0, seed: seed.id, seedRank: seedRank.get(seed.id) ?? 0 });
    bestDist.set(seed.id, 0);
    bestRank.set(seed.id, seedRank.get(seed.id) ?? 0);
    assignment.set(seed.id, seed.id);
  }

  queue.sort((a, b) => a.dist - b.dist || a.seedRank - b.seedRank);

  while (queue.length) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current.id) ?? [];
    for (const next of neighbors) {
      const dist = current.dist + 1;
      const prevDist = bestDist.get(next);
      const prevRank = bestRank.get(next);
      const rank = current.seedRank;
      if (prevDist === undefined || dist < prevDist || (dist === prevDist && rank < (prevRank ?? Infinity))) {
        bestDist.set(next, dist);
        bestRank.set(next, rank);
        assignment.set(next, current.seed);
        queue.push({ id: next, dist, seed: current.seed, seedRank: rank });
      }
    }
  }
}

export function projectGraph(graph: StateGraph, focus: ProjectionFocus): Projection {
  const zoom = Math.max(0, focus.zoom ?? 0);
  const radius = focus.radius ?? Math.max(1, DEFAULT_RADIUS - zoom);
  const budget = Math.max(4, (focus.budgetNodes ?? DEFAULT_BUDGET) - zoom * 8);
  const clusters = clusterGraph(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  const explicitFocus = focusNodeIdResolved(graph, focus);
  const centers = unique([
    explicitFocus,
    "system_root",
    ...(explicitFocus ? [] : [latestUserInputId(graph), latestAssistantOutputId(graph)])
  ].filter((id): id is string => typeof id === "string" && byId.has(id)));

  const focusSet = bfsBounded(graph, centers, radius, budget);
  const focusNodes = [...focusSet]
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .sort(byCreatedAt);

  const focusEdgeLines = graph.edges
    .filter((edge) => focusSet.has(edge.from) && focusSet.has(edge.to))
    .map((edge) => `edge ${edge.from} ${edge.type} ${edge.to}`);

  const focusClusterIds = new Set(
    clusters.filter((cluster) => cluster.nodeIds.some((id) => focusSet.has(id))).map((cluster) => cluster.id)
  );

  const peripheralClusters = clusters
    .filter((cluster) => !focusClusterIds.has(cluster.id) && clusterTouches(graph, cluster.nodeIds, focusSet))
    .sort((a, b) => b.nodeCount - a.nodeCount);

  const bigBrainClusters = [...clusters].sort((a, b) => createdAtOf(byId.get(a.seedId)) - createdAtOf(byId.get(b.seedId)));

  return { focusNodes, focusEdgeLines, peripheralClusters, bigBrainClusters, focusClusterIds: [...focusClusterIds] };
}

function bfsBounded(graph: StateGraph, centers: string[], radius: number, budget: number): Set<string> {
  const adjacency = undirectedAdjacency(graph);
  const visited = new Map<string, number>();
  const queue: Array<{ id: string; dist: number }> = [];

  for (const center of centers) {
    if (visited.has(center)) continue;
    visited.set(center, 0);
    queue.push({ id: center, dist: 0 });
  }

  while (queue.length) {
    if (visited.size >= budget) break;
    queue.sort((a, b) => a.dist - b.dist);
    const current = queue.shift()!;
    if (current.dist >= radius) continue;
    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) continue;
      visited.set(next, current.dist + 1);
      queue.push({ id: next, dist: current.dist + 1 });
      if (visited.size >= budget) break;
    }
  }

  return new Set(visited.keys());
}

function undirectedAdjacency(graph: StateGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  return adjacency;
}

function connectedComponent(graph: StateGraph, start: string, adjacency: Map<string, string[]>): Set<string> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id) || !ids.has(id)) continue;
    visited.add(id);
    for (const next of adjacency.get(id) ?? []) if (!visited.has(next)) queue.push(next);
  }
  return visited;
}

function clusterTouches(graph: StateGraph, nodeIds: string[], focusSet: Set<string>): boolean {
  const set = new Set(nodeIds);
  for (const edge of graph.edges) {
    const inCluster = set.has(edge.from) || set.has(edge.to);
    const touchesFocus = focusSet.has(edge.from) || focusSet.has(edge.to);
    if (inCluster && touchesFocus) return true;
  }
  return false;
}

function buildCluster(graph: StateGraph, seedId: string, nodeIds: string[], byId: Map<string, GraphNode>): Cluster {
  const set = new Set(nodeIds);
  const members = nodeIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
  const edgeCount = graph.edges.filter((edge) => set.has(edge.from) && set.has(edge.to)).length;
  const seed = byId.get(seedId);
  const typeCounts = new Map<string, number>();
  for (const node of members) typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
  const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "node";
  const label = seed ? oneLine(seed.text).slice(0, 64) : dominantType;
  const summary = `${members.length}n ${edgeCount}e · ${dominantType}`;
  return { id: clusterId(nodeIds), seedId, nodeIds, label, summary, nodeCount: members.length, edgeCount };
}

export function clusterId(nodeIds: string[]): string {
  return `cluster_${hashId([...nodeIds].sort().join("\u0001"))}`;
}

function focusNodeIdResolved(graph: StateGraph, focus: ProjectionFocus): string | undefined {
  const id = focus.focusNodeId;
  return id && graph.nodes.some((node) => node.id === id) ? id : undefined;
}

function latestUserInputId(graph: StateGraph): string | undefined {
  return [...graph.nodes].reverse().find((node) => node.type === "user_input")?.id;
}

function latestAssistantOutputId(graph: StateGraph): string | undefined {
  return [...graph.nodes].reverse().find((node) => node.type === "assistant_output")?.id;
}

function byCreatedAt(a: GraphNode | undefined, b: GraphNode | undefined): number {
  return createdAtOf(a) - createdAtOf(b);
}

function createdAtOf(node: GraphNode | undefined): number {
  if (!node) return Number.MAX_SAFE_INTEGER;
  const time = Date.parse(node.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hashId(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).padStart(4, "0").slice(-6);
}
