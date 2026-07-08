import { projectGraph, type Cluster } from "./projection.js";
import type { GraphFrame, GraphNode } from "./types.js";

export function serializeGraphFrame(frame: GraphFrame): string {
  const projection = projectGraph(frame.graph, { focusNodeId: frame.frame.focusNodeId, zoom: frame.frame.zoom });
  const lines: string[] = [
    "You are operating inside StateWeave.",
    "The graph is the runtime state; do not reconstruct this as provider messages[].",
    "Return StateWeave Exchange, not JSON, YAML, markdown, or prose.",
    "Start the response with exactly: SWX/1",
    "",
    "Tiny commands mutate the graph:",
    "@node <id> <type> \"short label\" status=active confidence=0.8 mime=text/plain",
    "@edge <from> <type> <to>",
    "@update <id> status=resolved text=\"short update\"",
    "@focus \"short next focus\" OR @focus <node_id> \"short reason\"",
    "@zoom <level>  (0 = tight focus, higher = see a wider map of topic clusters)",
    "@tool <tool_name> key=value multiline_arg_ref=block_id",
    "@worker <worker_id> objective=\"focused subtask\" focus=optional_node_id input=\"optional worker brief\" maxIterations=optional_number",
    "@final \"short human final answer\" artifact=optional_id artifacts=optional_id_1,optional_id_2",
    "@final_ref <answer_block_id> artifact=optional_id artifacts=optional_id_1,optional_id_2",
    "",
    "Raw blocks hold multiline content (file bodies, long final answers, SVG/HTML/code artifacts) — no escaping inside a block. Reference a block via *_ref attrs (@tool args) or @final_ref (final answer). The final answer must always be human-readable text, never just a node id:",
    "@tool write_file file_path=hello.html content_ref=html_1",
    "@node output_1 svg_artifact \"Generated output\" mime=image/svg+xml",
    "@edge user_input_1 creates output_1",
    "@final_ref final_answer artifact=output_1",
    "<<<html_1:text/html",
    "<h1>Hello</h1>",
    ">>>",
    "<<<final_answer:text/markdown",
    "Done — created the artifact.",
    ">>>",
    "",
    "Peripheral Vision:",
    "- The full StateGraph is append-only ground truth and is never compacted.",
    "- You are shown three layers: <BIG_BRAIN> (every topic cluster as a map pin), <PERIPHERAL> (nearby topic summaries), <FOCUS> (detailed nodes and edges for the active region).",
    "- Cluster ids (cluster_xxxx) are stable across turns — named regions you can travel to with @focus cluster_xxxx. Use @zoom <level> to widen the map (higher = more clusters as pins; 0 = max local detail).",
    "",
    "Keep commands small so model attention stays on the user's task.",
    "Use @worker when independent graph regions or subtasks can run in parallel. Do not include @final in the same transaction as @worker; after workers merge back as worker_result nodes, synthesize one final answer.",
    "Every completed turn must include exactly one @final or @final_ref with a human-readable answer unless the transaction spawned workers. Use artifacts= only as references, not as the answer itself.",
    "Cortex rules:",
    "- The StateGraph is non-linear working memory, not a transcript.",
    "- The latest user_input is pending attachment. Decide whether it starts from system_root, continues an existing user/assistant node, updates an existing output/semantic node, or relates to another graph region.",
    "- Return edge ops that weave the latest user_input into the graph before or along with the answer.",
    "- GraphOps are transactional: new nodes and the latest pending user_input must be connected to the existing graph, or the SDK rejects the transaction and asks you to retry.",
    "- Use structural node types only for runtime nodes: system, user_input, assistant_output, tool_call, tool_result.",
    "- For every other node, choose a concise lower_snake_case semantic type from the node meaning. Prefer configured semanticNodeTypes when they fit; create a new slug when they do not.",
    "- Mark outdated nodes stale/rejected with @update; connect contradictions, dependencies, and merges explicitly.",
    "- Use @focus <node_id> \"short reason\" whenever the active graph region should move.",
    "Node type format: lowercase semantic slug, or one of the structural runtime types.",
    "Allowed edge types: follows, creates, supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to.",
    "Allowed statuses: active, resolved, rejected, stale.",
    "",
    "Current GraphFrame:",
    "<FRAME>",
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `focusNodeId: ${frame.frame.focusNodeId ?? "unknown"}`,
    `zoom: ${frame.frame.zoom ?? 0}`,
    `latestInputNodeId: ${frame.frame.latestInputNodeId ?? latestNodeId(frame, "user_input") ?? "unknown"}`,
    `activeUserInputNodeId: ${frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId ?? "unknown"}`,
    `candidateFocusNodeIds: ${(frame.frame.candidateFocusNodeIds ?? ["system_root"]).join(", ")}`,
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
    ...bigBrainLines(projection.bigBrainClusters, projection.focusClusterIds),
    "</BIG_BRAIN>",
    ""
  ];

  if (projection.peripheralClusters.length) {
    lines.push("<PERIPHERAL>");
    lines.push(...projection.peripheralClusters.map((cluster) => clusterPin(cluster)));
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
  const timelineNodes = frame.graph.nodes
    .filter((node) => node.type !== "system" && node.type !== "tool_call" && node.type !== "tool_result")
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
    .slice(-15);
  if (timelineNodes.length > 1) {
    lines.push("", "<TIMELINE>", "(most recent facts in creation order — use for chronology/sequence questions)");
    for (const node of timelineNodes) lines.push(`- ${node.id} [${node.type}]: ${truncate(node.text, 80)}`);
    lines.push("</TIMELINE>");
  }

  return lines.join("\n");
}

function bigBrainLines(clusters: Cluster[], focusClusterIds: string[]): string[] {
  if (!clusters.length) return ["(no topics yet)"];
  const focusSet = new Set(focusClusterIds);
  return clusters.map((cluster) => {
    const mark = focusSet.has(cluster.id) ? " *" : "";
    return `- ${cluster.id}${mark} (${cluster.summary}) "${truncate(cluster.label, 70)}"`;
  });
}

function clusterPin(cluster: Cluster): string {
  return `- ${cluster.id} (${cluster.summary}) "${truncate(cluster.label, 96)}"`;
}

function truncate(value: string, max: number): string {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function latestNodeId(frame: GraphFrame, type: GraphNode["type"]): string | undefined {
  return [...frame.graph.nodes].reverse().find((node) => node.type === type)?.id;
}

function nodeDataSummary(node: GraphNode): string {
  if (!node.data) return "";
  const parts = Object.entries(node.data).map(([key, value]) => {
    if (key === "content" && typeof value === "string") {
      return `contentLength=${value.length} contentPreview=${JSON.stringify(oneLine(value.slice(0, 360)))}`;
    }
    return `${key}=${JSON.stringify(value)}`;
  });
  return parts.length ? ` data ${parts.join(" ")}` : "";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
