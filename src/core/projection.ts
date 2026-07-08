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
const RETRIEVAL_BUDGET_CHRONOLOGY = 32;
// Hard ceiling on the rendered <FOCUS> window. Positional BFS (budget) plus
// retrieval plus per-retrieved cluster-member expansion can otherwise push a
// mature graph's focus to 80+ nodes, bloating the prompt until the model hits
// wall-clock limits (a timeout reads as a recall miss even when the answer is
// reachable). Capped focus preserves retrieved answer-candidates, centers, and
// relational context; the <BIG_BRAIN>/<PERIPHERAL>/<TIMELINE> layers still give
// a full map of everything else.
const FOCUS_NODE_CAP = 40;

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
  const chronologyMode = looksLikeChronology(activeNodeText);
  const retrievalBudget = chronologyMode ? RETRIEVAL_BUDGET_CHRONOLOGY : RETRIEVAL_BUDGET;
  const retrievedNodeIds = looksLikeQuestion(activeNodeText)
    ? retrieveNodes(graph, clusters, activeNodeText, retrievalBudget, chronologyMode)
    : [];

  // Merge positional + retrieved into the final focus set.
  const focusSet = new Set<string>([...positionalFocus, ...retrievedNodeIds]);

  // Relational + sibling context for synthesis/combine. Atomized semantic
  // facts (fact, artifact, decision, ...) carry only their bare value and drop
  // both the framing prose and the OTHER facts that were stated alongside them
  // in the same conversational turn. So when retrieval recalls ONE fact from a
  // turn, combine probes that need that turn's sibling facts (e.g. "plan a
  // party for my sister" needs BOTH the shellfish allergy AND the family pet
  // from the same turn; "derive the reduction ratio" needs BOTH the native
  // focal length AND the reducer) fail: the model sees the single recalled fact
  // and hedges instead of synthesizing the turn as a whole. This is exactly the
  // fragmentation naive messages[] avoids by keeping a turn's full prose
  // together. It also bites retrieval itself: a recalled user_input (which
  // scores on the framing nouns like "sister") is structural and was skipped,
  // so its sibling facts were never co-located.
  //
  // Fix: for every retrieved node, pull in its originating user_input AND that
  // user_input's other directly-connected semantic facts (the siblings) as
  // distinct, co-visible focus nodes. This lets the model synthesize across
  // co-occurring facts the way it would from a turn's prose. It replaces an
  // earlier "first 8 oldest cluster members" expansion which, for a merged
  // multi-topic cluster, just re-injected unrelated oldest facts and crowded
  // out exactly the siblings combine needs.
  const retrievalAdjacency = undirectedAdjacency(graph);
  const relationalNeighborIds = new Set<string>();
  const expandOrigin = (originId: string): void => {
    const origin = byId.get(originId);
    if (!origin) return;
    focusSet.add(originId);
    relationalNeighborIds.add(originId);
    for (const siblingId of retrievalAdjacency.get(originId) ?? []) {
      const sibling = byId.get(siblingId);
      if (!sibling || isStructural(sibling.type)) continue;
      focusSet.add(siblingId);
      relationalNeighborIds.add(siblingId);
    }
  };
  for (const nodeId of retrievedNodeIds) {
    const node = byId.get(nodeId);
    if (!node) continue;
    if (node.type === "user_input") {
      // A recalled user_input is its own origin; expand its sibling facts so
      // the turn's full fact set is co-visible (it scores on framing nouns).
      expandOrigin(nodeId);
      continue;
    }
    if (isStructural(node.type)) continue;
    // A recalled semantic fact: expand via its originating user_input(s).
    for (const neighborId of retrievalAdjacency.get(nodeId) ?? []) {
      const neighbor = byId.get(neighborId);
      if (neighbor?.type === "user_input") expandOrigin(neighborId);
    }
  }

  const focusNodes = capFocusNodes(
    [...focusSet]
      .map((id) => byId.get(id))
      .filter((node): node is GraphNode => Boolean(node)),
    retrievedNodeIds,
    new Set(centers),
    relationalNeighborIds,
    FOCUS_NODE_CAP
  ).sort(byCreatedAt);

  // Only render edges between nodes that survived the focus cap, so the detail
  // window never references nodes the model cannot see.
  const visibleNodeIds = new Set(focusNodes.map((node) => node.id));
  const focusEdgeLines = graph.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => `edge ${edge.from} ${edge.type} ${edge.to}`);

  const nodeToClusterId = new Map<string, string>();
  for (const cluster of clusters) {
    for (const nodeId of cluster.nodeIds) nodeToClusterId.set(nodeId, cluster.id);
  }

  const focusClusterIds = new Set(
    [...focusSet]
      .map((nodeId) => nodeToClusterId.get(nodeId))
      .filter((id): id is string => Boolean(id))
  );

  const peripheralClusterIds = touchedPeripheralClusters(graph, nodeToClusterId, focusSet, focusClusterIds);
  const peripheralClusters = clusters
    .filter((cluster) => peripheralClusterIds.has(cluster.id))
    .sort((a, b) => b.nodeCount - a.nodeCount);

  const bigBrainClusters = [...clusters].sort((a, b) => createdAtOf(byId.get(a.seedId)) - createdAtOf(byId.get(b.seedId)));

  return { focusNodes, focusEdgeLines, peripheralClusters, bigBrainClusters, focusClusterIds: [...focusClusterIds], retrievedNodeIds };
}

// --- Retrieval: deterministic keyword matching ---

function isStructural(nodeType: string): boolean {
  return nodeType === "system" || nodeType === "user_input" || nodeType === "assistant_output" || nodeType === "tool_call" || nodeType === "tool_result";
}

function looksLikeQuestion(text: string): boolean {
  if (!text || text.length < 8) return false;
  const lower = text.toLowerCase();
  return /\b(what|who|when|where|which|how|why|recall|what's|name the|identify|list|deadline|rule|code|password|pin|access|color|time|rate|length|amount|how much|how many)\b/.test(lower)
    || lower.includes("?")
    || /^(show|tell|give|find|retrieve|look up|what is)/.test(lower);
}

function looksLikeChronology(text: string): boolean {
  if (!text) return false;
  return /\b(first|last|earlier|later|before|after|chronolog|then|sequence|initial|initially|final|oldest|newest|order)\b/i.test(text);
}

function retrieveNodes(graph: StateGraph, clusters: Cluster[], queryText: string, budget: number, chronologyMode = false): string[] {
  const keywords = extractKeywords(queryText);
  if (!keywords.length) return [];

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const clusterLookup = new Map<string, Cluster>();
  for (const cluster of clusters) {
    for (const nodeId of cluster.nodeIds) clusterLookup.set(nodeId, cluster);
  }
  const userInputTextByNode = userInputContextByNode(graph, byId);

  const scored: Array<{ id: string; score: number }> = [];
  for (const node of graph.nodes) {
    if (node.type === "system" || node.type === "tool_call" || node.type === "tool_result") continue;
    const parts = [`${node.type} ${node.text}`.toLowerCase()];
    const userContext = userInputTextByNode.get(node.id);
    if (userContext) parts.push(userContext);

    // Also include the merged cluster seed as a fallback for nodes that have no
    // direct user_input context (for backwards-compat with merged semantic
    // clusters used by the current peripheral vision model).
    const cluster = clusterLookup.get(node.id);
    if (cluster) {
      const seed = byId.get(cluster.seedId);
      if (seed) parts.push(oneLine(seed.text).toLowerCase());
    }

    const text = parts.join(" ");
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += kw.length > 4 ? 3 : 2;
    }
    // Boost nodes that hold data (facts, artifacts, decisions carry the answers).
    if (node.type === "fact" || node.type === "artifact" || node.type === "decision" || node.type === "assistant_output") score += 1;
    // For chronology probes, surface user-input turn sources more reliably than
    // very recent noise so ordered questions can compare historical intent accurately.
    if (chronologyMode && node.type === "user_input") score += 2;
    if (score > 0) scored.push({ id: node.id, score });
  }

  const sorted = scored
    .sort((a, b) => b.score - a.score || (chronologyMode
      ? createdAtOf(byId.get(a.id)) - createdAtOf(byId.get(b.id))
      : createdAtOf(byId.get(b.id)) - createdAtOf(byId.get(a.id))));

  const selected = new Set<string>(
    sorted
      .slice(0, budget)
      .map((s) => s.id)
  );

  // Ensure semantically relevant historical user_inputs are not starved by recency
  // bias: older turns should stay reachable when the probe references names/facts
  // embedded in user_input prose but their matching nodes rank outside the budget.
  for (const item of sorted.slice(0, Math.min(6, sorted.length))) {
    const node = byId.get(item.id);
    if (node?.type === "user_input") selected.add(item.id);
    if (selected.size >= budget + 2) break;
  }

  return [...selected];
}

function userInputContextByNode(graph: StateGraph, byId: Map<string, GraphNode>): Map<string, string> {
  const adjacency = undirectedAdjacency(graph);
  const userInputs = graph.nodes.filter((node) => node.type === "user_input").sort(byCreatedAt);
  const assignment = new Map<string, string>();
  const bestDist = new Map<string, number>();
  const bestRank = new Map<string, number>();
  const queue: Array<{ id: string; dist: number; source: string; rank: number }> = [];

  userInputs.forEach((node, index) => {
    assignment.set(node.id, node.id);
    bestDist.set(node.id, 0);
    bestRank.set(node.id, index);
    queue.push({ id: node.id, dist: 0, source: node.id, rank: index });  });

  let index = 0;
  while (index < queue.length) {
    const current = queue[index++];
    if (!current) continue;
    const neighbors = adjacency.get(current.id) ?? [];
    for (const next of neighbors) {
      const dist = current.dist + 1;
      const prevDist = bestDist.get(next);
      const prevRank = bestRank.get(next);
      const nextRank = current.rank;

      if (prevDist === undefined || dist < prevDist || (dist === prevDist && nextRank < (prevRank ?? Number.MAX_SAFE_INTEGER))) {
        assignment.set(next, current.source);
        bestDist.set(next, dist);
        bestRank.set(next, nextRank);
        queue.push({ id: next, dist, source: current.source, rank: nextRank });
      }
    }
  }

  const finalContext = new Map<string, string>();
  for (const [nodeId, sourceId] of assignment) {
    const sourceText = byId.get(sourceId)?.text;
    if (!sourceText) continue;
    finalContext.set(nodeId, oneLine(sourceText).toLowerCase());
  }

  return finalContext;
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
  const rawWords = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const words: string[] = [];
  for (const word of rawWords) {
    if (stop.has(word)) continue;
    for (const variant of keywordForms(word)) {
      if (!stop.has(variant)) words.push(variant);
    }
  }
  // Dedupe, prefer longer words (more specific), keep top 12.
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 12);
}

function keywordForms(value: string): string[] {
  const forms = new Set([value]);
  if (value.length > 5 && value.endsWith("ing")) {
    forms.add(value.slice(0, -3));
  }
  if (value.length > 4 && value.endsWith("ed")) {
    forms.add(value.slice(0, -2));
    forms.add(`${value.slice(0, -2)}e`);
  }
  if (value.length > 4 && value.endsWith("s")) {
    forms.add(value.slice(0, -1));
  }
  return [...forms];
}

// --- Focus cap: keep retrieved answer-candidates, centers, and relational
// context first, then fill with the most recent positional nodes. Small graphs
// (below the cap) pass through unchanged.
function capFocusNodes(
  nodes: GraphNode[],
  retrievedNodeIds: string[],
  centerSet: Set<string>,
  relationalNeighborIds: Set<string>,
  maxNodes: number
): GraphNode[] {
  if (nodes.length <= maxNodes) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const retained = new Set<string>();
  // Centers (system_root, focus node, latest user/assistant) are structural
  // anchors the model needs to write valid GraphOps — always retain them.
  for (const id of centerSet) if (byId.has(id)) retained.add(id);
  // Retrieved nodes hold the answer candidates.
  for (const id of retrievedNodeIds) if (byId.has(id) && retained.size < maxNodes) retained.add(id);
  // Relational context frames atomized facts for synthesis.
  for (const id of relationalNeighborIds) if (byId.has(id) && retained.size < maxNodes) retained.add(id);
  // Fill remaining slots with the newest positional nodes.
  const rest = nodes
    .filter((node) => !retained.has(node.id))
    .sort((a, b) => createdAtOf(b) - createdAtOf(a));
  for (const node of rest) {
    if (retained.size >= maxNodes) break;
    retained.add(node.id);
  }
  return [...retained].map((id) => byId.get(id)!);
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
    const rank = seedRank.get(seed.id) ?? 0;
    queue.push({ id: seed.id, dist: 0, seed: seed.id, seedRank: rank });
    bestDist.set(seed.id, 0);
    bestRank.set(seed.id, rank);
    assignment.set(seed.id, seed.id);
  }

  let index = 0;
  while (index < queue.length) {
    const current = queue[index++]!;
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

  let index = 0;
  while (index < queue.length) {
    if (visited.size >= budget) break;
    const current = queue[index++];
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
  let index = 0;
  while (index < queue.length) {
    const id = queue[index++];
    if (!id || visited.has(id) || !ids.has(id)) continue;
    visited.add(id);
    for (const next of adjacency.get(id) ?? []) if (!visited.has(next)) queue.push(next);
  }
  return visited;
}

function touchedPeripheralClusters(graph: StateGraph, nodeToClusterId: Map<string, string>, focusSet: Set<string>, focusClusterIds: Set<string>): Set<string> {
  const peripheral = new Set<string>();

  for (const edge of graph.edges) {
    const fromCluster = nodeToClusterId.get(edge.from);
    const toCluster = nodeToClusterId.get(edge.to);
    if (!fromCluster || !toCluster || fromCluster === toCluster) continue;

    if (focusSet.has(edge.from) && !focusClusterIds.has(toCluster)) {
      peripheral.add(toCluster);
    }
    if (focusSet.has(edge.to) && !focusClusterIds.has(fromCluster)) {
      peripheral.add(fromCluster);
    }
  }

  return peripheral;
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
