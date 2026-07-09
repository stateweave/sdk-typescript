import { projectGraph, type Cluster } from "./projection.js";
import type { GraphFrame, GraphNode } from "./types.js";

const BIG_BRAIN_LIMIT = 20;
const PERIPHERAL_CLUSTER_LIMIT = 12;
const CANDIDATE_FOCUS_LIMIT = 24;
const TIMELINE_LIMIT = 15;
const TIMELINE_CHRONOLOGY_LIMIT = 30;
const TIMELINE_CHRONOLOGY_NEIGHBORHOOD = 4;
const TIMELINE_CHRONOLOGY_HEAD = 6;

export function serializeGraphFrame(frame: GraphFrame): string {
  const projection = projectGraph(frame.graph, { focusNodeId: frame.frame.focusNodeId, zoom: frame.frame.zoom });
  const candidateFocusIds = unique((frame.frame.candidateFocusNodeIds ?? ["system_root"]).filter((value): value is string => Boolean(value)));
  const activeUserInput = activeUserInputText(frame);
  const chronologyMode = looksLikeChronology(activeUserInput);
  const lines: string[] = [
    "You are operating inside StateWeave. The graph is the runtime state; do not reconstruct this as provider messages[].",
    "Return StateWeave Exchange (not JSON/YAML/markdown/prose). Start the response with exactly: SWX/1",
    "",
    "Commands: @node <id> <type> \"label\" status=active confidence=0.8 mime=text/plain | @edge <from> <type> <to> | @update <id> status=resolved text=\"update\" | @focus \"next focus\"|<node_id> \"reason\" | @zoom <level> (0=tight, higher=wider map) | @tool <name> key=value multiline_arg_ref=block_id | @final \"human answer\" artifact=id artifacts=a,b | @final_ref <block_id> artifact=id artifacts=a,b",
    "Raw blocks (<<<block_id:mime ... >>>) hold multiline content/artifacts; reference via *_ref or @final_ref. Final answer is always human-readable text, never just a node id.",
    "Structural node types: system, user_input, assistant_output, tool_call, tool_result; all others are lower_snake_case semantic slugs (prefer configured semanticNodeTypes). Edge types: follows, creates, supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to. Statuses: active, resolved, rejected, stale.",
    "Peripheral Vision: the StateGraph is append-only ground truth, never compacted. Layers: <BIG_BRAIN> (topic cluster map pins), <PERIPHERAL> (nearby cluster summaries), <FOCUS> (detailed nodes/edges for the active region), <TIMELINE> (recent facts in creation order). Cluster ids (cluster_xxxx) are stable; travel with @focus cluster_xxxx or widen with @zoom.",
    "Cortex: the StateGraph is non-linear working memory, not a transcript. The latest user_input is pending attachment — decide whether it starts from system_root, continues an existing user/assistant node, updates an output/semantic node, or relates elsewhere. Every new node and the latest user_input MUST connect to the existing graph via @edge or the SDK rejects the transaction. Weave the latest user_input in before/with the answer. Mark outdated nodes stale/rejected via @update and connect contradictions/dependencies/merges explicitly. On conflict prompts, prefer status=resolved/active and treat stale/rejected as superseded unless the user asks for history.",
    "Every completed turn must include exactly one @final or @final_ref with a human-readable answer. The @final text is the ONLY thing a human/grader reads — write it like a direct answer to a person, lead with the recalled fact itself (e.g. 'Your NexStar 8SE is stored in bay #3.'), never with graph references, hedging, or meta commentary. CRITICAL: the @final answer must NEVER contain internal node ids or graph labels (user_input_N, assistant_output_N, cluster_xxxx, node_..., system_root) — those are SDK bookkeeping; citing them reads as evasive/hallucinated and fails recall even when you retrieved the right fact. Reference nodes only in @node/@edge/@focus ops, never in @final. Be terse: if the user only asks to recall or answer a factual question, emit just SWX/1 and a single @final line with the direct answer — add @node/@edge only when you are actually recording a new fact or weaving a new user_input. Shorter output is better.",
    "",
    "Current GraphFrame:",
    "<FRAME>",
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `focusNodeId: ${frame.frame.focusNodeId ?? "unknown"}`,
    `zoom: ${frame.frame.zoom ?? 0}`,
    `latestInputNodeId: ${frame.frame.latestInputNodeId ?? latestNodeId(frame, "user_input") ?? "unknown"}`,
    `activeUserInputNodeId: ${frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId ?? "unknown"}`,
    `candidateFocusNodeIds: ${formatLimitedList(candidateFocusIds, CANDIDATE_FOCUS_LIMIT)}`,
    `nextExpectedOutput: ${frame.frame.nextExpectedOutput}`,
    ...(frame.frame.lastGraphOpsError ? [`lastGraphOpsError: ${frame.frame.lastGraphOpsError}`] : []),
    "activeConstraints:",
    ...frame.frame.activeConstraints.map((c) => `- ${c}`),
    "availableActions:",
    ...frame.frame.availableActions.map((a) => `- ${a}`),
    "semanticNodeTypes:",
    ...(frame.frame.nodeTypes?.length ? frame.frame.nodeTypes.map((type) => `- ${type}`) : ["- (none configured; choose semantic slugs from node meaning)"]),
    "</FRAME>",
    "",
    "<BIG_BRAIN>",
    ...bigBrainLines(projection.bigBrainClusters, projection.focusClusterIds, BIG_BRAIN_LIMIT),
    "</BIG_BRAIN>",
    ""
  ];

  if (projection.peripheralClusters.length) {
    lines.push("<PERIPHERAL>");
    const peripheral = projection.peripheralClusters.slice(0, PERIPHERAL_CLUSTER_LIMIT);
    lines.push(...peripheral.map((cluster) => clusterPin(cluster)));
    if (projection.peripheralClusters.length > PERIPHERAL_CLUSTER_LIMIT) {
      lines.push(`... +${projection.peripheralClusters.length - PERIPHERAL_CLUSTER_LIMIT} peripheral cluster${projection.peripheralClusters.length - PERIPHERAL_CLUSTER_LIMIT === 1 ? "" : "s"} omitted`);
    }
    lines.push("</PERIPHERAL>", "");
  }

  lines.push("<FOCUS>");
  if (projection.focusNodes.length) {
    for (const node of projection.focusNodes) lines.push(`node ${node.id} [${node.type}]: ${node.text}${nodeDataSummary(node)}`);
    lines.push(...projection.focusEdgeLines);
  } else {
    lines.push("(empty focus window — use @focus <node_id> or @zoom 3 to widen your vision)");
  }
  lines.push("</FOCUS>");

  // Timeline: recent facts in creation order so chronology probes survive projection.
  const timelineNodes = buildTimelineNodes(
    frame.graph.nodes,
    projection,
    (node) => node.type !== "system" && node.type !== "tool_call" && node.type !== "tool_result",
    chronologyMode
  );
  if (timelineNodes.length > 1) {
    lines.push("", "<TIMELINE>", `(${chronologyMode ? "expanded" : "most recent"} facts in creation order — use for chronology/sequence questions)`);
    timelineNodes.forEach((node, index) => {
      const prefix = chronologyMode ? `${index + 1}. ` : "";
      lines.push(`- ${prefix}${node.id} [${node.type}]: ${truncate(node.text, 80)}`);
    });
    lines.push("</TIMELINE>");
  }

  return lines.join("\n");
}

function bigBrainLines(clusters: Cluster[], focusClusterIds: string[], limit: number): string[] {
  if (!clusters.length) return ["(no topics yet)"];
  const focusSet = new Set(focusClusterIds);
  const focused = clusters.filter((cluster) => focusSet.has(cluster.id));
  const remaining = clusters.filter((cluster) => !focusSet.has(cluster.id));
  const shown = [...focused, ...remaining].slice(0, Math.max(limit, focused.length));
  return shown.map((cluster) => {
    const mark = focusSet.has(cluster.id) ? " *" : "";
    return `- ${cluster.id}${mark} (${cluster.summary}) "${truncate(cluster.label, 70)}"`;
  });
}

function clusterPin(cluster: Cluster): string {
  return `- ${cluster.id} (${cluster.summary}) "${truncate(cluster.label, 96)}"`;
}

function buildTimelineNodes(
  nodes: GraphNode[],
  projection: { retrievedNodeIds: string[] },
  predicate: (node: GraphNode) => boolean,
  chronologyMode: boolean
): GraphNode[] {
  const visibleNodes = nodes.filter(predicate);
  const visibleOrdered = [...visibleNodes].sort((a, b) => createdAtOf(a) - createdAtOf(b));

  if (!chronologyMode) {
    return visibleOrdered.slice(-TIMELINE_LIMIT);
  }

  const byId = new Map(visibleOrdered.map((node) => [node.id, node]));
  const indexById = new Map(visibleOrdered.map((node, index) => [node.id, index] as const));
  const selected = new Set<string>(recentNodes(visibleOrdered, () => true, TIMELINE_CHRONOLOGY_LIMIT).map((node) => node.id));
  for (const node of visibleOrdered.slice(0, TIMELINE_CHRONOLOGY_HEAD)) {
    selected.add(node.id);
  }

  for (const nodeId of projection.retrievedNodeIds) {
    const index = indexById.get(nodeId);
    if (index === undefined) continue;
    for (let offset = -TIMELINE_CHRONOLOGY_NEIGHBORHOOD; offset <= TIMELINE_CHRONOLOGY_NEIGHBORHOOD; offset++) {
      const neighbor = visibleOrdered[index + offset];
      if (neighbor) selected.add(neighbor.id);
    }
  }

  return [...selected].map((id) => byId.get(id)!).filter((node): node is GraphNode => Boolean(node)).sort((a, b) => createdAtOf(a) - createdAtOf(b));
}

function recentNodes(nodes: GraphNode[], predicate: (node: GraphNode) => boolean, limit: number): GraphNode[] {
  const selected: GraphNode[] = [];
  for (let index = nodes.length - 1; index >= 0 && selected.length < limit; index--) {
    const node = nodes[index];
    if (node && predicate(node)) selected.push(node);
  }
  return selected.reverse();
}

function looksLikeChronology(text: string | undefined): boolean {
  if (!text) return false;
  return /\b(first|last|earlier|later|before|after|chronolog|then|sequence|initial|initially|final|oldest|newest)\b/i.test(text);
}

function activeUserInputText(frame: GraphFrame): string | undefined {
  const activeId = frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId;
  if (!activeId) return undefined;
  const input = frame.graph.nodes.find((node) => node.id === activeId);
  return input?.type === "user_input" ? input.text : undefined;
}

function createdAtOf(node: GraphNode | undefined): number {
  if (!node) return Number.MAX_SAFE_INTEGER;
  const time = Date.parse(node.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

function truncate(value: string, max: number): string {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatLimitedList(values: string[], limit: number): string {
  const shown = values.slice(0, limit);
  const omitted = values.length - shown.length;
  return `${shown.join(", ")}${omitted > 0 ? ` ... +${omitted} more` : ""}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function latestNodeId(frame: GraphFrame, type: GraphNode["type"]): string | undefined {
  return [...frame.graph.nodes].reverse().find((node) => node.type === type)?.id;
}

function nodeDataSummary(node: GraphNode): string {
  const parts: string[] = [];

  if (node.status) {
    parts.push(`status=${node.status}`);
  }

  if (node.data) {
    for (const [key, value] of Object.entries(node.data)) {
      if (key === "content" && typeof value === "string") {
        parts.push(`contentLength=${value.length} contentPreview=${JSON.stringify(oneLine(value.slice(0, 360)))}`);
      } else {
        parts.push(`${key}=${JSON.stringify(value)}`);
      }
    }
  }

  return parts.length ? ` data ${parts.join(" ")}` : "";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
