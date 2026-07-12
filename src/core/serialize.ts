import { projectGraph, type Cluster } from "./projection.js";
import type { GraphFrame, GraphNode } from "./types.js";

const BIG_BRAIN_LIMIT = 64;
const PERIPHERAL_CLUSTER_LIMIT = 24;
const CANDIDATE_FOCUS_LIMIT = 24;
const TIMELINE_LIMIT = 32;
const TIMELINE_CHRONOLOGY_LIMIT = 96;
const TIMELINE_CHRONOLOGY_NEIGHBORHOOD = 12;
const TIMELINE_CHRONOLOGY_HEAD = 16;

export function serializeGraphFrame(frame: GraphFrame): string {
  const projection = projectGraph(frame.graph, { focusNodeId: frame.frame.focusNodeId, zoom: frame.frame.zoom });
  const candidateFocusIds = unique((frame.frame.candidateFocusNodeIds ?? ["system_root"]).filter((value): value is string => Boolean(value)));
  const activeUserInput = activeUserInputText(frame);
  const chronologyMode = looksLikeChronology(activeUserInput);
  const lines: string[] = [
    "You are operating inside StateWeave. The graph is the runtime state; do not reconstruct this as provider messages[].",
    "Return StateWeave Exchange (not JSON/YAML/markdown/prose). Start the response with exactly: SWX/1",
    "",
    "Commands: @node <id> <type> \"label\" status=active confidence=0.8 mime=text/plain | @edge <from> <type> <to> | @update <id> status=resolved text=\"update\" | @focus \"next focus\"|<node_id> \"reason\" | @zoom <level> (0=tight, higher=wider map) | @tool <name> key=value multiline_arg_ref=block_id | @final \"human answer\" artifact=id artifacts=a,b outcome=already_satisfied | @final_ref <block_id> artifact=id artifacts=a,b outcome=already_satisfied",
    "Raw blocks (<<<block_id:mime ... >>>) hold multiline content/artifacts; reference via *_ref or @final_ref. Final answer is always human-readable text, never just a node id.",
    "Evidence tool loop: every read_file, write_file, edit_file, or bash_command call must be the ONLY tool in its transaction and MUST NOT be combined with @final or @worker. Call one tool, stop, inspect its typed tool_result in the next GraphFrame, then decide the next operation. Failed mutations are recorded as rejected tool_result nodes and do not commit proposed semantic GraphOps. Never claim a change or check succeeded without successful tool evidence. If inspection proves a requested mutation is already present, verify it and return @final with outcome=already_satisfied; never make a fake edit.",
    "Structural node types: system, user_input, assistant_output, tool_call, tool_result; all others are lower_snake_case semantic slugs (prefer configured semanticNodeTypes). Edge types: follows, creates, supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to. Statuses: active, resolved, rejected, stale.",
    "Peripheral Vision: the StateGraph is append-only ground truth, never compacted. Layers: <BIG_BRAIN> (topic cluster map pins), <PERIPHERAL> (nearby cluster summaries), <FOCUS> (detailed nodes/edges for the active region), <TIMELINE> (recent facts in creation order). Cluster ids (cluster_xxxx) are stable; travel with @focus cluster_xxxx or widen with @zoom.",
    "Cortex: the StateGraph is non-linear working memory, not a transcript. StateWeave deterministically connects the latest user_input, tool evidence, new semantic nodes, and final output to the active task; do not spend output rebuilding structural bookkeeping. Add semantic edges only when they convey a meaningful dependency, contradiction, validation, or decision. Mark outdated facts stale/rejected via @update; on conflicts prefer active canonical file-state nodes and successful tool_result evidence over stale/rejected claims.",
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

  // Stable global chronological rank over ALL non-system nodes, tie-broken by
  // emission (array) order. This is the authoritative ordering signal: nodes
  // emitted in the same GraphOps transaction share a createdAt timestamp, so raw
  // timestamp ordering ties and would read as "simultaneous" — but their array
  // index preserves the exact order the model wrote them, which is the real
  // intra-turn chronology. Exposing this rank explicitly in <FOCUS> (for
  // chronology probes) and <TIMELINE> lets the model answer "which came first"
  // by comparing ranks instead of inferring it from an undifferentiated list.
  const chronoRank = buildChronologicalRank(frame.graph.nodes);

  lines.push("<FOCUS>");
  if (projection.focusNodes.length) {
    for (const node of projection.focusNodes) {
      const rank = chronoRank.get(node.id);
      const rankTag = chronologyMode && rank !== undefined ? ` #${rank}` : "";
      lines.push(`node ${node.id} [${node.type}]:${rankTag} ${node.text}${nodeDataSummary(node)}`);
    }
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
    const header = chronologyMode
      ? "expanded facts in STRICT creation order (ties broken by emission order). #N is the global chronological rank: a LOWER # means established EARLIER. For any 'which came first / before / after / sequence' question, compare these ranks directly and answer with the lowest-# fact first — never claim two facts were simultaneous just because they share a turn."
      : "most recent facts in creation order — use for chronology/sequence questions";
    lines.push("", "<TIMELINE>", `(${header})`);
    timelineNodes.forEach((node) => {
      const rank = chronoRank.get(node.id);
      const prefix = chronologyMode && rank !== undefined ? `#${rank} ` : "";
      lines.push(`- ${prefix}${node.id} [${node.type}]: ${truncate(node.text, 80)}`);
    });
    lines.push("</TIMELINE>");
  }

  return lines.join("\n");
}

// Global chronological rank: 1-based, over non-system nodes, sorted by
// (createdAt asc, original array index asc). The array-index tie-break is what
// recovers intra-turn emission order when timestamps tie within one
// GraphOps transaction — without it the model loses all ordering signal inside
// a turn and chronology probes collapse to "same time".
function buildChronologicalRank(nodes: GraphNode[]): Map<string, number> {
  const ranked = nodes
    .map((node, index) => ({ node, index }))
    .filter((entry) => entry.node.type !== "system" && entry.node.type !== "tool_call" && entry.node.type !== "tool_result")
    .sort((a, b) => createdAtOf(a.node) - createdAtOf(b.node) || a.index - b.index);
  const rank = new Map<string, number>();
  ranked.forEach((entry, position) => rank.set(entry.node.id, position + 1));
  return rank;
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
  // Tie-break by original array index so nodes that share a createdAt (the
  // common case for facts atomized in one GraphOps transaction) keep their
  // emission order instead of collapsing to an arbitrary / simultaneous order.
  const originalIndex = new Map<string, number>();
  nodes.forEach((node, index) => originalIndex.set(node.id, index));
  const byChrono = (a: GraphNode, b: GraphNode) => createdAtOf(a) - createdAtOf(b) || (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);

  const visibleNodes = nodes.filter(predicate);
  const visibleOrdered = [...visibleNodes].sort(byChrono);

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

  return [...selected].map((id) => byId.get(id)!).filter((node): node is GraphNode => Boolean(node)).sort(byChrono);
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
