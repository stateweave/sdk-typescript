import type { EdgeType, GraphNode, StateGraph } from "./types.js";

// Peripheral Vision: the StateGraph is append-only ground truth that is never
// compacted. The projection is a disposable, bounded, multi-resolution VIEW of
// that graph. The model always sees a big-brain overview (the map), a periphery
// of nearby topics, and a detailed focus window for the active region.
//
// The focus window is query-aware: when the active node looks like a question
// or recall probe, we deterministically search ALL nodes for keyword matches
// and pull those answer nodes (and their clusters) into view. This fixes the
// "found no record" recall failures where the answer lived outside the BFS radius.

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
  dominantType: string;
};

export type Projection = {
  focusNodes: GraphNode[];
  focusEdgeLines: string[];
  peripheralClusters: Cluster[];
  bigBrainClusters: Cluster[];
  focusClusterIds: string[];
  retrievedNodeIds: string[];
};

const DEFAULT_RADIUS = 4;
const DEFAULT_BUDGET = 64;
const RETRIEVAL_BUDGET = 24;

export function clusterGraph(graph: StateGraph): Cluster[] {
  const nodes = graph.nodes;
  if (!nodes.length) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = undirectedAdjacency(graph);

  // Step 1: initial per-turn assignment via multi-source BFS from user_inputs.
  const rawClusters = initialTurnClusters(graph, adjacency, byId);

  // Step 2: topic-merge — combine clusters whose nodes share the same semantic
  // domain (dominant non-structural node type). This prevents the telescope
  // topic from being scattered across 15 turn-clusters.
  const merged = mergeClustersByDomain(rawClusters, graph, byId);

  return merged
    .sort((a, b) => createdAtOf(byId.get(a.seedId)) - createdAtOf(byId.get(b.seedId)));
}

export function projectGraph(graph: StateGraph, focus: ProjectionFocus): Projection {
  const zoom = Math.max(0, focus.zoom ?? 0);
  const radius = focus.radius ?? Math.max(1, DEFAULT_RADIUS - zoom);
  const budget = Math.max(8, (focus.budgetNodes ?? DEFAULT_BUDGET) - zoom * 8);
  const clusters = clusterGraph(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  const explicitFocus = focusNodeIdResolved(graph, focus);
  const centers = unique([
    explicitFocus,
    "system_root",
    ...(explicitFocus ? [] : [latestUserInputId(graph), latestAssistantOutputId(graph)])
  ].filter((id): id is string => typeof id === "string" && byId.has(id)));

  // Positional focus: BFS from the active centers.
  const positionalFocus = bfsBounded(graph, centers, radius, budget);

  // Retrieval focus: if the active node looks like a question, search ALL nodes
  // for keyword matches and pull them (and their clusters) into view.
  const activeNodeText = centers
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => node !== undefined && node.type === "user_input")
    .map((node) => node.text)
    .join(" ");
  const retrievedNodeIds = looksLikeQuestion(activeNodeText)
    ? retrieveNodes(graph, activeNodeText, RETRIEVAL_BUDGET)
    : [];

  // Merge positional + retrieved into the final focus set.
  const focusSet = new Set<string>([...positionalFocus, ...retrievedNodeIds]);

  // If retrieval found nodes in clusters NOT already in the positional focus,
  // expand to include those clusters' seed + key members (so combine works).
  for (const nodeId of retrievedNodeIds) {
    const cluster = clusters.find((c) => c.nodeIds.includes(nodeId));
    if (!cluster) continue;
    for (const memberId of cluster.nodeIds.slice(0, 8)) focusSet.add(memberId);
  }

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

  return { focusNodes, focusEdgeLines, peripheralClusters, bigBrainClusters, focusClusterIds: [...focusClusterIds], retrievedNodeIds };
}

// --- Retrieval: deterministic keyword matching ---

function looksLikeQuestion(text: string): boolean {
  if (!text || text.length < 8) return false;
  const lower = text.toLowerCase();
  return /\b(what|who|when|where|which|how|why|recall|what's|name the|identify|list|deadline|rule|code|password|pin|access|color|time|rate|length|amount|how much|how many)\b/.test(lower)
    || lower.includes("?")
    || /^(show|tell|give|find|retrieve|look up|what is)/.test(lower);
}

function retrieveNodes(graph: StateGraph, queryText: string, budget: number): string[] {
  const keywords = extractKeywords(queryText);
  if (!keywords.length) return [];

  const scored: Array<{ id: string; score: number }> = [];
  for (const node of graph.nodes) {
    if (node.type === "system" || node.type === "tool_call" || node.type === "tool_result") continue;
    const text = `${node.type} ${node.text}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += kw.length > 4 ? 3 : 2;
    }
    // Boost nodes that hold data (facts, artifacts, decisions carry the answers).
    if (node.type === "fact" || node.type === "artifact" || node.type === "decision" || node.type === "assistant_output") score += 1;
    if (score > 0) scored.push({ id: node.id, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || createdAtOf(graph.nodes.find((n) => n.id === b.id)) - createdAtOf(graph.nodes.find((n) => n.id === a.id)))
    .slice(0, budget)
    .map((s) => s.id);
}

function extractKeywords(text: string): string[] {
  const stop = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall",
    "to", "of", "in", "on", "at", "by", "for", "with", "about", "as", "into", "like", "through",
    "after", "over", "between", "out", "against", "during", "without", "before", "under",
    "around", "among", "and", "or", "but", "if", "then", "else", "when", "where", "why",
    "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "not", "only", "own", "same", "so", "than", "too", "very", "can", "just",
    "what", "who", "whom", "this", "that", "these", "those", "i", "me", "my", "we", "our",
    "you", "your", "it", "its", "they", "them", "their", "from", "up", "down", "out",
    "mention", "mentioned", "recall", "setup", "set up", "earlier", "before", "tonight",
    "session", "log", "record", "records", "system", "need", "know", "tell", "give",
    "find", "show", "help", "want", "trying", "figure", "update", "updating", "trying",
    "mentioned", "say", "said", "establish", "established", "plan", "planned", "specific",
    "exactly", "rule", "guideline"
  ]);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
  // Dedupe, prefer longer words (more specific), keep top 12.
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 12);
}

// --- Clustering ---

type RawCluster = { seedId: string; nodeIds: string[] };

function initialTurnClusters(graph: StateGraph, adjacency: Map<string, string[]>, byId: Map<string, GraphNode>): RawCluster[] {
  const seeds = graph.nodes.filter((node) => node.type === "user_input").sort(byCreatedAt);
  const assignment = new Map<string, string>();

  if (seeds.length) {
    assignToNearestSeed(seeds, adjacency, assignment);
  }

  for (const node of graph.nodes) {
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

  return [...buckets.entries()].map(([seedId, nodeIds]) => ({ seedId, nodeIds }));
}

function assignToNearestSeed(seeds: GraphNode[], adjacency: Map<string, string[]>, assignment: Map<string, string>): void {
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

function mergeClustersByDomain(rawClusters: RawCluster[], graph: StateGraph, byId: Map<string, GraphNode>): Cluster[] {
  const built = rawClusters.map((rc) => buildCluster(graph, rc.seedId, rc.nodeIds.sort((a, b) => createdAtOf(byId.get(a)) - createdAtOf(byId.get(b))), byId));

  // Group clusters by their dominant semantic type (excluding structural types).
  // Clusters that share the same domain get merged into one topic.
  const byDomain = new Map<string, Cluster[]>();
  for (const cluster of built) {
    const domain = semanticDomain(cluster.dominantType);
    const bucket = byDomain.get(domain) ?? [];
    bucket.push(cluster);
    byDomain.set(domain, bucket);
  }

  const merged: Cluster[] = [];
  for (const [, group] of byDomain) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    // Merge all clusters in the same domain into one.
    const allNodeIds = group.flatMap((c) => c.nodeIds);
    const seedId = group.sort((a, b) => createdAtOf(byId.get(a.seedId)) - createdAtOf(byId.get(b.seedId)))[0].seedId;
    merged.push(buildCluster(graph, seedId, allNodeIds.sort((a, b) => createdAtOf(byId.get(a)) - createdAtOf(byId.get(b))), byId));
  }

  return merged;
}

function semanticDomain(nodeType: string): string {
  // Structural types stay separate (they're conversational spine).
  // Semantic types merge by family so related facts cluster together.
  if (nodeType === "user_input" || nodeType === "assistant_output" || nodeType === "system") return `structural_${nodeType}`;
  if (nodeType === "tool_call" || nodeType === "tool_result") return "tools";
  // All semantic types (fact, artifact, decision, hypothesis, etc.) merge into
  // a shared "knowledge" domain UNLESS there are enough to form a distinct topic.
  // For now, keep each semantic type as its own domain — this prevents merging
  // unrelated facts while still grouping within a type.
  return `semantic_${nodeType}`;
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
  return { id: clusterId(nodeIds), seedId, nodeIds, label, summary, nodeCount: members.length, edgeCount, dominantType };
}

export function clusterId(nodeIds: string[]): string {
  return `cluster_${hashId([...nodeIds].sort().join("\u0001"))}`;
}

// --- BFS / graph utilities ---

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
