import { agentStateToGraph } from "./causalGraph.js";
import { buildCausalHierarchy, type CausalHierarchy } from "./causalHierarchy.js";
import { projectCausalSnapshot, type CausalProjection } from "./causalProjection.js";
import type { CausalWeaveSnapshot } from "./causalTypes.js";
import type { GraphEdge, GraphNode, StateGraph } from "./types.js";

export type CausalVisualGraphMode = "focus" | "map" | "full";
export type CausalVisualTopicState = "collapsed" | "full";
export type CausalVisualLeafState = "collapsed" | "full";

export type CausalVisualGraphOptions = {
  maxVisibleNodes?: number;
  preferredNodeIds?: Iterable<string>;
};

export type CausalVisualGraphProjection = {
  graph: StateGraph;
  hierarchy: CausalHierarchy;
  projection: CausalProjection;
  visibleNodeIds: string[];
};

export type CausalVisualGraphViewOptions = {
  mode?: CausalVisualGraphMode;
  topicStates?: ReadonlyMap<string, CausalVisualTopicState>;
  leafStates?: ReadonlyMap<string, CausalVisualLeafState>;
  archiveExpanded?: boolean;
  topicLimit?: number;
  leafLimit?: number;
};

export type CausalVisualTopicControl = {
  id: string;
  label: string;
  sequence: number;
  nodeCount: number;
  leafCount: number;
  focusCount: number;
  state: "collapsed" | "focus" | "full";
  archived: boolean;
};

export type CausalVisualLeafControl = {
  id: string;
  topicId: string;
  label: string;
  sequence: number;
  nodeCount: number;
  focusCount: number;
  state: "collapsed" | "focus" | "full";
  archived: boolean;
};

export type CausalVisualGraphView = {
  graph: StateGraph;
  hierarchical: boolean;
  sourceNodeCount: number;
  renderedSourceNodeCount: number;
  summaryNodeCount: number;
  focusNodeCount: number;
  topics: CausalVisualTopicControl[];
  leaves: CausalVisualLeafControl[];
  archivedTopicCount: number;
  archivedNodeCount: number;
};

const DEFAULT_VISIBLE_NODES = 16;
const DEFAULT_TOPIC_LIMIT = 8;
const DEFAULT_LEAF_LIMIT = 4;

export function projectCausalVisualSnapshot(snapshot: CausalWeaveSnapshot, options: CausalVisualGraphOptions = {}): CausalVisualGraphProjection {
  const projection = projectCausalSnapshot(snapshot);
  const hierarchy = buildCausalHierarchy(snapshot, projection);
  const maxVisibleNodes = boundedPositiveInteger(options.maxVisibleNodes ?? DEFAULT_VISIBLE_NODES, "maxVisibleNodes");
  const visibleNodeIds = selectVisualNodeIds(snapshot, projection, maxVisibleNodes, options.preferredNodeIds);
  const visible = new Set(visibleNodeIds);
  const topicById = new Map(hierarchy.topics.map((topic) => [topic.id, topic]));
  const leafById = new Map(hierarchy.leaves.map((leaf) => [leaf.id, leaf]));
  const source = agentStateToGraph(snapshot);
  const graph = {
    nodes: source.nodes.map((node) => {
      const leafId = hierarchy.leafByNodeId.get(node.id);
      const leaf = leafId ? leafById.get(leafId) : undefined;
      const topicId = hierarchy.topicByNodeId.get(node.id);
      const topic = topicId ? topicById.get(topicId) : undefined;
      const system = node.type === "system";
      return {
        ...node,
        data: {
          ...node.data,
          visualFocus: visible.has(node.id),
          ...(topic && !system ? {
            hierarchyTopicId: topic.id,
            hierarchyTopicKey: topic.key,
            hierarchyTopicLabel: topic.label,
            hierarchyTopicSequence: topic.sequence,
            hierarchyTopicNodeCount: topic.nodeIds.length
          } : {}),
          ...(leaf && !system ? {
            hierarchyLeafId: leaf.id,
            hierarchyLeafLabel: leaf.label,
            hierarchyLeafSequence: leaf.sequence,
            hierarchyLeafNodeCount: leaf.nodeIds.length,
            moleculeId: leaf.id,
            moleculeLabel: leaf.label,
            moleculeSequence: leaf.sequence
          } : {})
        }
      };
    }),
    edges: source.edges
  };
  return { graph, hierarchy, projection, visibleNodeIds };
}

export function projectCausalVisualGraphView(source: StateGraph, options: CausalVisualGraphViewOptions = {}): CausalVisualGraphView {
  const mode = options.mode ?? "focus";
  const topicLimit = boundedPositiveInteger(options.topicLimit ?? DEFAULT_TOPIC_LIMIT, "topicLimit");
  const leafLimit = boundedPositiveInteger(options.leafLimit ?? DEFAULT_LEAF_LIMIT, "leafLimit");
  const hierarchy = readHierarchy(source);
  if (!hierarchy.topics.length || mode === "full") {
    return {
      graph: source,
      hierarchical: Boolean(hierarchy.topics.length),
      sourceNodeCount: source.nodes.length,
      renderedSourceNodeCount: source.nodes.length,
      summaryNodeCount: 0,
      focusNodeCount: source.nodes.filter(isVisualFocus).length,
      topics: hierarchy.topics.map((topic) => topicControl(topic, "full", false)),
      leaves: hierarchy.leaves.map((leaf) => leafControl(leaf, "full", false)),
      archivedTopicCount: 0,
      archivedNodeCount: 0
    };
  }

  const fold = new VisualFold(hierarchy, options, topicLimit, leafLimit, options.archiveExpanded === true || mode === "map");
  const mapNodeId = (node: GraphNode): string => fold.mapNodeId(node);
  const focusNodeIds = new Set(source.nodes.filter(isVisualFocus).map((node) => node.id));
  const displayNodes = [...groupByMappedId(source.nodes, mapNodeId)].map(([id, members]) => fold.displayNode(id, members, focusNodeIds));
  const sourceById = new Map(source.nodes.map((node) => [node.id, node]));
  const graph = {
    nodes: displayNodes.sort(compareGraphNodes),
    edges: visualEdges(source.edges, sourceById, mapNodeId, displayNodes)
  };
  const renderedSourceNodeCount = graph.nodes.filter((node) => node.data?.visualSynthetic !== true).length;
  return {
    graph,
    hierarchical: true,
    sourceNodeCount: source.nodes.length,
    renderedSourceNodeCount,
    summaryNodeCount: graph.nodes.length - renderedSourceNodeCount,
    focusNodeCount: source.nodes.filter(isVisualFocus).length,
    ...fold.controls(),
    archivedTopicCount: fold.archiveCandidates.length,
    archivedNodeCount: new Set(fold.archiveCandidates.flatMap((topic) => topic.nodeIds)).size
  };
}

type VisualState = "collapsed" | "focus" | "full";
const ARCHIVE_ID = "visual_archive_topics";

const newestFirst = (left: { sequence: number; id: string }, right: { sequence: number; id: string }): number =>
  right.sequence - left.sequence || left.id.localeCompare(right.id);
const focusedNewestFirst = (left: { focusCount: number; sequence: number; id: string }, right: { focusCount: number; sequence: number; id: string }): number =>
  Number(right.focusCount > 0) - Number(left.focusCount > 0) || newestFirst(left, right);

function groupByMappedId(nodes: GraphNode[], mapNodeId: (node: GraphNode) => string): Map<string, GraphNode[]> {
  const grouped = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const id = mapNodeId(node);
    const members = grouped.get(id) ?? [];
    members.push(node);
    grouped.set(id, members);
  }
  return grouped;
}

/** Which topics and leaves stay expanded, which fold into summaries, and how source nodes map onto display nodes. */
class VisualFold {
  readonly archiveCandidates: VisualTopic[];
  private readonly retainedTopicIds: Set<string>;
  private readonly archivedTopicIds: Set<string>;
  private readonly archivedLeafIds = new Set<string>();

  constructor(
    private readonly hierarchy: VisualHierarchy,
    private readonly options: CausalVisualGraphViewOptions,
    topicLimit: number,
    private readonly leafLimit: number,
    archiveExpanded: boolean
  ) {
    const orderedTopics = [...hierarchy.topics].sort(newestFirst);
    this.retainedTopicIds = new Set(hierarchy.topics.filter((topic) => topic.focusCount > 0).map((topic) => topic.id));
    for (const topic of orderedTopics) {
      if (this.retainedTopicIds.size >= topicLimit) break;
      this.retainedTopicIds.add(topic.id);
    }
    this.archiveCandidates = orderedTopics.filter((topic) => !this.retainedTopicIds.has(topic.id));
    if (archiveExpanded) for (const topic of this.archiveCandidates) this.retainedTopicIds.add(topic.id);
    this.archivedTopicIds = new Set(archiveExpanded ? [] : this.archiveCandidates.map((topic) => topic.id));
    for (const topic of hierarchy.topics) this.archiveLeaves(topic);
  }

  topicState(topic: VisualTopic): VisualState {
    return this.options.topicStates?.get(topic.id) ?? (topic.focusCount > 0 ? "focus" : "collapsed");
  }

  leafState(leaf: VisualLeaf): VisualState {
    return this.options.leafStates?.get(leaf.id) ?? (leaf.focusCount > 0 ? "focus" : "collapsed");
  }

  mapNodeId(node: GraphNode): string {
    if (node.type === "system") return node.id;
    const topicId = stringData(node, "hierarchyTopicId");
    const leafId = stringData(node, "hierarchyLeafId");
    if (!topicId || !leafId) return node.id;
    if (this.archivedTopicIds.has(topicId)) return ARCHIVE_ID;
    const topic = this.hierarchy.topicById.get(topicId);
    if (!topic || this.topicState(topic) === "collapsed") return visualTopicId(topicId);
    if (this.archivedLeafIds.has(leafId)) return visualTopicArchiveId(topicId);
    const leaf = this.hierarchy.leafById.get(leafId);
    if (!leaf) return node.id;
    const state = this.leafState(leaf);
    if (state === "full" || (state === "focus" && isVisualFocus(node))) return node.id;
    return visualLeafId(leafId);
  }

  displayNode(id: string, members: GraphNode[], focusNodeIds: Set<string>): GraphNode {
    const first = members[0]!;
    if (members.length === 1 && id === first.id) return first;
    if (id === ARCHIVE_ID) return summaryNode(id, "archive", "Earlier topics", members, { visualTopicIds: [...this.archivedTopicIds] });
    const topicId = stringData(first, "hierarchyTopicId");
    const topicLabel = this.hierarchy.topicById.get(topicId)?.label;
    if (id.startsWith("visual_topic_archive_")) return summaryNode(id, "topic_archive", `${topicLabel ?? "Topic"} history`, members, { hierarchyTopicId: topicId });
    if (id.startsWith("visual_topic_")) return summaryNode(id, "topic", topicLabel ?? "Topic", members, { hierarchyTopicId: topicId });
    const leafId = stringData(first, "hierarchyLeafId");
    const leaf = this.hierarchy.leafById.get(leafId);
    const visibleMembers = leaf ? leaf.nodeIds.filter((nodeId) => focusNodeIds.has(nodeId)).length : 0;
    const suffix = visibleMembers ? "more source atoms" : "source atoms";
    return summaryNode(id, "leaf", `${leaf?.label ?? "Subgraph"}: ${members.length} ${suffix}`, members, { hierarchyTopicId: topicId, hierarchyLeafId: leafId });
  }

  controls(): { topics: CausalVisualTopicControl[]; leaves: CausalVisualLeafControl[] } {
    return {
      topics: this.hierarchy.topics
        .map((topic) => topicControl(topic, this.topicState(topic), this.archivedTopicIds.has(topic.id)))
        .sort(focusedNewestFirst),
      leaves: this.hierarchy.leaves
        .map((leaf) => leafControl(leaf, this.leafState(leaf), this.archivedLeafIds.has(leaf.id) || this.archivedTopicIds.has(leaf.topicId)))
        .sort(focusedNewestFirst)
    };
  }

  /** In a focus-state topic, keep focused leaves plus the newest `leafLimit`; fold the rest into topic history. */
  private archiveLeaves(topic: VisualTopic): void {
    if (!this.retainedTopicIds.has(topic.id) || this.topicState(topic) !== "focus") return;
    const leaves = this.hierarchy.leaves.filter((leaf) => leaf.topicId === topic.id).sort(newestFirst);
    const focused = leaves.filter((leaf) => leaf.focusCount > 0);
    const retained = new Set(focused.map((leaf) => leaf.id));
    for (const leaf of leaves) {
      if (retained.size >= focused.length + this.leafLimit) break;
      retained.add(leaf.id);
    }
    for (const leaf of leaves) if (!retained.has(leaf.id)) this.archivedLeafIds.add(leaf.id);
  }
}

type VisualTopic = {
  id: string;
  label: string;
  sequence: number;
  nodeIds: string[];
  leafIds: string[];
  focusCount: number;
};

type VisualLeaf = {
  id: string;
  topicId: string;
  label: string;
  sequence: number;
  nodeIds: string[];
  focusCount: number;
};

type VisualHierarchy = {
  topics: VisualTopic[];
  leaves: VisualLeaf[];
  topicById: Map<string, VisualTopic>;
  leafById: Map<string, VisualLeaf>;
};

function readHierarchy(graph: StateGraph): VisualHierarchy {
  const topics = new Map<string, VisualTopic>();
  const leaves = new Map<string, VisualLeaf>();
  for (const node of graph.nodes) {
    const topicId = stringData(node, "hierarchyTopicId");
    const leafId = stringData(node, "hierarchyLeafId");
    if (!topicId || !leafId) continue;
    const topic = topics.get(topicId) ?? {
      id: topicId,
      label: stringData(node, "hierarchyTopicLabel") || "Topic",
      sequence: numberData(node, "hierarchyTopicSequence"),
      nodeIds: [],
      leafIds: [],
      focusCount: 0
    };
    topic.nodeIds.push(node.id);
    if (!topic.leafIds.includes(leafId)) topic.leafIds.push(leafId);
    if (isVisualFocus(node)) topic.focusCount += 1;
    topics.set(topicId, topic);

    const leaf = leaves.get(leafId) ?? {
      id: leafId,
      topicId,
      label: stringData(node, "hierarchyLeafLabel") || "Subgraph",
      sequence: numberData(node, "hierarchyLeafSequence"),
      nodeIds: [],
      focusCount: 0
    };
    leaf.nodeIds.push(node.id);
    if (isVisualFocus(node)) leaf.focusCount += 1;
    leaves.set(leafId, leaf);
  }
  const topicList = [...topics.values()].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const leafList = [...leaves.values()].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  return { topics: topicList, leaves: leafList, topicById: topics, leafById: leaves };
}

function selectVisualNodeIds(snapshot: CausalWeaveSnapshot, projection: CausalProjection, maxNodes: number, preferredNodeIds?: Iterable<string>): string[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const reverse = [...snapshot.nodes].reverse();
  const latestSystem = reverse.find((node) => node.kind === "system")?.id;
  const latestGoal = reverse.find((node) => node.kind === "goal")?.id;
  const latestAnswer = reverse.find((node) => node.kind === "answer")?.id;
  const priority = [
    latestSystem,
    latestGoal,
    ...snapshot.frontier,
    ...(preferredNodeIds ? [...preferredNodeIds] : []),
    latestAnswer,
    ...[...projection.focusNodeIds].reverse(),
    ...[...projection.timelineNodeIds].reverse()
  ];
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const id of priority) {
    if (!id || seen.has(id) || !byId.has(id)) continue;
    selected.push(id);
    seen.add(id);
    if (selected.length >= maxNodes) break;
  }
  return selected;
}

type AggregatedVisualEdge = { from: string; to: string; count: number; types: Set<GraphEdge["type"]>; latest: GraphEdge };

function visualEdges(
  sourceEdges: GraphEdge[],
  sourceById: Map<string, GraphNode>,
  mapNodeId: (node: GraphNode) => string,
  displayNodes: GraphNode[]
): GraphEdge[] {
  const displayById = new Map(displayNodes.map((node) => [node.id, node]));
  const aggregated = new Map<string, AggregatedVisualEdge>();
  for (const edge of sourceEdges) {
    const fromNode = sourceById.get(edge.from);
    const toNode = sourceById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const from = mapNodeId(fromNode);
    const to = mapNodeId(toNode);
    if (from === to) continue;
    const key = `${from}\u0000${to}`;
    const current = aggregated.get(key);
    if (!current) {
      aggregated.set(key, { from, to, count: 1, types: new Set([edge.type]), latest: edge });
      continue;
    }
    current.count += 1;
    current.types.add(edge.type);
    if (edge.createdAt > current.latest.createdAt) current.latest = edge;
  }

  const incoming = new Map<string, AggregatedVisualEdge[]>();
  for (const edge of aggregated.values()) {
    const values = incoming.get(edge.to) ?? [];
    values.push(edge);
    incoming.set(edge.to, values);
  }
  const selected: GraphEdge[] = [];
  for (const candidates of incoming.values()) {
    candidates.sort((left, right) => visualEdgeScore(right, displayById) - visualEdgeScore(left, displayById) || right.latest.createdAt.localeCompare(left.latest.createdAt) || left.from.localeCompare(right.from));
    for (const edge of candidates.slice(0, 4)) {
      const types = [...edge.types].sort();
      const type = edge.types.has("follows") ? "follows" : edge.types.has("causes") ? "causes" : edge.latest.type;
      const key = `${edge.from}\u0000${edge.to}`;
      selected.push({
        id: `edge_${stableHash(key)}`,
        from: edge.from,
        to: edge.to,
        type,
        createdAt: edge.latest.createdAt,
        data: { visualSourceEdgeCount: edge.count, visualSourceEdgeTypes: types }
      });
    }
  }
  return selected.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function visualEdgeScore(edge: { from: string; count: number; types: Set<GraphEdge["type"]> }, displayById: Map<string, GraphNode>): number {
  const from = displayById.get(edge.from);
  return (from?.type === "system" ? 100 : 0)
    + (from?.data?.visualSynthetic === true ? 0 : 12)
    + (edge.types.has("follows") ? 24 : 0)
    + (edge.types.has("validates") || edge.types.has("supports") || edge.types.has("creates") ? 16 : 0)
    + Math.min(10, Math.log2(edge.count + 1));
}

function summaryNode(id: string, kind: "archive" | "topic" | "topic_archive" | "leaf", label: string, members: GraphNode[], extra: Record<string, unknown>): GraphNode {
  const ordered = [...members].sort(compareGraphNodes);
  const focusCount = members.filter(isVisualFocus).length;
  return {
    id,
    type: kind === "topic" || kind === "archive" || kind === "topic_archive" ? "topic" : "molecule",
    text: label,
    data: {
      visualSynthetic: true,
      visualKind: kind,
      visualMemberIds: ordered.map((member) => member.id),
      visualSourceCount: members.length,
      visualFocusCount: focusCount,
      moleculeCollapsed: true,
      ...extra
    },
    status: members.some((member) => member.status === "active") ? "active" : "resolved",
    createdAt: ordered.at(-1)?.createdAt ?? new Date(0).toISOString()
  };
}

function topicControl(topic: VisualTopic, state: "collapsed" | "focus" | "full", archived: boolean): CausalVisualTopicControl {
  return { id: topic.id, label: topic.label, sequence: topic.sequence, nodeCount: topic.nodeIds.length, leafCount: topic.leafIds.length, focusCount: topic.focusCount, state, archived };
}

function leafControl(leaf: VisualLeaf, state: "collapsed" | "focus" | "full", archived: boolean): CausalVisualLeafControl {
  return { id: leaf.id, topicId: leaf.topicId, label: leaf.label, sequence: leaf.sequence, nodeCount: leaf.nodeIds.length, focusCount: leaf.focusCount, state, archived };
}

function visualTopicId(topicId: string): string {
  return `visual_topic_${topicId}`;
}

function visualTopicArchiveId(topicId: string): string {
  return `visual_topic_archive_${topicId}`;
}

function visualLeafId(leafId: string): string {
  return `visual_leaf_${leafId}`;
}

function isVisualFocus(node: GraphNode): boolean {
  return node.data?.visualFocus === true;
}

function stringData(node: GraphNode, key: string): string {
  const value = node.data?.[key];
  return typeof value === "string" ? value : "";
}

function numberData(node: GraphNode, key: string): number {
  const value = node.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareGraphNodes(left: GraphNode, right: GraphNode): number {
  const leftSequence = numberData(left, "sequence") || numberData(left, "hierarchyLeafSequence") || Date.parse(left.createdAt);
  const rightSequence = numberData(right, "sequence") || numberData(right, "hierarchyLeafSequence") || Date.parse(right.createdAt);
  return leftSequence - rightSequence || left.id.localeCompare(right.id);
}

function boundedPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
