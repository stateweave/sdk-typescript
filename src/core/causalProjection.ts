import { agentStateToGraph } from "./causalGraph.js";
import { projectGraph, type Cluster } from "./projection.js";
import type { CausalWeaveSnapshot } from "./causalTypes.js";
import type { StateGraph } from "./types.js";
import { asRecord, stableStringify, stringValue } from "./stableJson.js";

export type CausalProjectionCluster = Pick<Cluster, "id" | "label" | "summary" | "nodeCount" | "edgeCount" | "dominantType" | "nodeIds">;

export type CausalProjection = {
  focusNodeIds: string[];
  timelineNodeIds: string[];
  focusClusterIds: string[];
  bigBrainClusters: CausalProjectionCluster[];
  peripheralClusters: CausalProjectionCluster[];
};

export function projectCausalSnapshot(snapshot: CausalWeaveSnapshot): CausalProjection {
  const source = agentStateToGraph(snapshot);
  const latestSystem = [...snapshot.nodes].reverse().find((node) => node.kind === "system");
  const aliases = new Map<string, string>();
  if (latestSystem) aliases.set(latestSystem.id, "system_root");
  const currentNodeIds = currentProjectionNodes(snapshot);
  const graph = remapGraph(source, aliases, currentNodeIds);
  const latestGoal = [...snapshot.nodes].reverse().find((node) => node.kind === "goal");
  const projected = projectGraph(graph, { focusNodeId: latestGoal ? aliases.get(latestGoal.id) ?? latestGoal.id : undefined });
  const reverseAliases = new Map([...aliases].map(([sourceId, projectedId]) => [projectedId, sourceId]));
  const toSourceId = (id: string): string => reverseAliases.get(id) ?? id;
  const bySequence = [...snapshot.nodes].sort((a, b) => a.sequence - b.sequence);
  const timelineNodeIds = bySequence
    .filter((node) => node.kind !== "system" && node.kind !== "tool_call" && node.kind !== "tool_result" && currentNodeIds.has(node.id))
    .slice(-32)
    .map((node) => node.id);

  const systemClusterIds = new Set(projected.bigBrainClusters.filter((cluster) => cluster.nodeIds.includes("system_root")).map((cluster) => cluster.id));
  return {
    focusNodeIds: unique(projected.focusNodes.filter((node) => currentNodeIds.has(toSourceId(node.id))).map((node) => toSourceId(node.id))),
    timelineNodeIds,
    focusClusterIds: projected.focusClusterIds.filter((id) => !systemClusterIds.has(id)),
    bigBrainClusters: projected.bigBrainClusters.map((cluster) => compactCluster(cluster, toSourceId)),
    peripheralClusters: projected.peripheralClusters.map((cluster) => compactCluster(cluster, toSourceId))
  };
}

function remapGraph(graph: StateGraph, aliases: Map<string, string>, currentNodeIds: Set<string>): StateGraph {
  const remap = (id: string): string => aliases.get(id) ?? id;
  const nodes = graph.nodes.map((node) => ({
    ...node,
    id: remap(node.id),
    ...(currentNodeIds.has(node.id) ? {} : { status: "stale" as const })
  }));
  const edges = graph.edges.map((edge) => ({ ...edge, from: remap(edge.from), to: remap(edge.to) }));
  return { nodes, edges };
}

function currentProjectionNodes(snapshot: CausalWeaveSnapshot): Set<string> {
  const latest = new Map<string, string>();
  for (const node of snapshot.nodes) {
    const key = projectionKey(node);
    if (key) latest.set(key, node.id);
  }
  return new Set(snapshot.nodes.filter((node) => {
    const key = projectionKey(node);
    return !key || latest.get(key) === node.id;
  }).map((node) => node.id));
}

function projectionKey(node: CausalWeaveSnapshot["nodes"][number]): string | undefined {
  const payload = asRecord(node.payload);
  if ((node.kind === "resource" || node.kind === "semantic") && node.resourceKey) return `${node.kind}:${node.resourceKey}`;
  if (node.kind === "inference" || node.kind === "protocol_error") return `${node.kind}:${stableStringify(node.payload)}`;
  if (node.kind === "tool_call") return `tool_call:${stringValue(payload.name)}:${stableStringify(payload.args)}`;
  if (node.kind === "tool_result") return `tool_result:${stringValue(payload.tool)}:${stableStringify(payload.result)}`;
  return undefined;
}

function compactCluster(cluster: Cluster, toSourceId: (id: string) => string): CausalProjectionCluster {
  return {
    id: cluster.id,
    label: cluster.label,
    summary: cluster.summary,
    nodeCount: cluster.nodeCount,
    edgeCount: cluster.edgeCount,
    dominantType: cluster.dominantType,
    nodeIds: cluster.nodeIds.map(toSourceId)
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

