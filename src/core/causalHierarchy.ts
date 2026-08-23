import type { CausalProjection, CausalProjectionCluster } from "./causalProjection.js";
import type { CausalWeaveNode, CausalWeaveSnapshot } from "./causalTypes.js";

export type CausalHierarchyLeaf = {
  id: string;
  topicId: string;
  clusterId: string;
  label: string;
  summary: string;
  nodeIds: string[];
  sequence: number;
};

export type CausalHierarchyTopic = {
  id: string;
  key: string;
  label: string;
  summary: string;
  leafIds: string[];
  nodeIds: string[];
  sequence: number;
};

export type CausalHierarchy = {
  sessionId: "session";
  topics: CausalHierarchyTopic[];
  leaves: CausalHierarchyLeaf[];
  topicByNodeId: Map<string, string>;
  leafByNodeId: Map<string, string>;
};

const LEAVES_PER_TIME_TOPIC = 8;
export function buildCausalHierarchy(snapshot: CausalWeaveSnapshot, projection: CausalProjection): CausalHierarchy {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const leaves = projection.bigBrainClusters.map((cluster) => makeLeaf(cluster, byId));
  const grouped = new Map<string, CausalHierarchyLeaf[]>();
  const unkeyed: CausalHierarchyLeaf[] = [];

  for (const leaf of leaves) {
    const key = explicitTopicKey(leaf, byId);
    if (!key) {
      unkeyed.push(leaf);
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(leaf);
    grouped.set(key, group);
  }

  for (let index = 0; index < unkeyed.length; index += LEAVES_PER_TIME_TOPIC) {
    const chunk = unkeyed.slice(index, index + LEAVES_PER_TIME_TOPIC);
    const first = chunk[0];
    if (first) grouped.set(`time:${first.sequence}:${index / LEAVES_PER_TIME_TOPIC}`, chunk);
  }

  const topics = [...grouped.entries()]
    .map(([key, members]) => makeTopic(key, members))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const topicByNodeId = new Map<string, string>();
  const leafByNodeId = new Map<string, string>();
  const leafById = new Map(leaves.map((leaf) => [leaf.id, leaf]));

  for (const topic of topics) {
    for (const leafId of topic.leafIds) {
      const leaf = leafById.get(leafId);
      if (!leaf) continue;
      for (const nodeId of leaf.nodeIds) {
        topicByNodeId.set(nodeId, topic.id);
        leafByNodeId.set(nodeId, leaf.id);
      }
    }
  }

  return { sessionId: "session", topics, leaves, topicByNodeId, leafByNodeId };
}

function makeLeaf(cluster: CausalProjectionCluster, byId: Map<string, CausalWeaveNode>): CausalHierarchyLeaf {
  const sequence = Math.min(...cluster.nodeIds.map((id) => byId.get(id)?.sequence ?? Number.MAX_SAFE_INTEGER));
  return {
    id: `leaf_${cluster.id}`,
    topicId: "",
    clusterId: cluster.id,
    label: cluster.label,
    summary: cluster.summary,
    nodeIds: [...cluster.nodeIds],
    sequence: Number.isFinite(sequence) ? sequence : 0
  };
}

function makeTopic(key: string, members: CausalHierarchyLeaf[]): CausalHierarchyTopic {
  const ordered = [...members].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const sequence = ordered[0]?.sequence ?? 0;
  const id = `topic_${stableHash(key + "\u0000" + ordered.map((leaf) => leaf.id).join("\u0001"))}`;
  const label = topicLabel(key, ordered);
  const nodeIds = [...new Set(ordered.flatMap((leaf) => leaf.nodeIds))];
  for (const leaf of ordered) leaf.topicId = id;
  return {
    id,
    key,
    label,
    summary: `${ordered.length} subgraph${ordered.length === 1 ? "" : "s"} · ${nodeIds.length} source atoms`,
    leafIds: ordered.map((leaf) => leaf.id),
    nodeIds,
    sequence
  };
}

function explicitTopicKey(leaf: CausalHierarchyLeaf, byId: Map<string, CausalWeaveNode>): string | undefined {
  const nodes = leaf.nodeIds.map((id) => byId.get(id)).filter((node): node is CausalWeaveNode => Boolean(node));
  const text = nodes.map((node) => payloadText(node.payload)).join(" ").toLowerCase();
  const path = text.match(/\b(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:css|csv|html|js|json|md|py|svg|ts|txt)\b/)?.[0];
  if (path) return `file:${path}`;
  const entity = text.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+\b/)?.[0];
  if (entity) return `entity:${entity}`;
  const semantic = nodes.find((node) => node.kind === "semantic");
  if (semantic && semantic.payload && typeof semantic.payload === "object") {
    const payload = semantic.payload as Record<string, unknown>;
    if (typeof payload.type === "string" && typeof payload.key === "string") return `semantic:${payload.type}:${payload.key}`;
  }
  return undefined;
}

function topicLabel(key: string, leaves: CausalHierarchyLeaf[]): string {
  if (key.startsWith("file:")) return key.slice("file:".length);
  if (key.startsWith("entity:")) return key.slice("entity:".length);
  if (key.startsWith("semantic:")) return key.slice("semantic:".length);
  const first = leaves[0];
  const last = leaves.at(-1);
  return first && last ? `Timeline ${first.sequence}–${last.sequence}` : "Timeline";
}

function payloadText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try { return JSON.stringify(payload) ?? ""; } catch { return String(payload); }
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36).padStart(6, "0").slice(-8);
}
