import type { GraphFrame, GraphNode } from "./types.js";

export function serializeGraphFrame(frame: GraphFrame): string {
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
    "@tool <tool_name> key=value multiline_arg_ref=block_id",
    "@final \"short human final answer\" artifact=optional_id artifacts=optional_id_1,optional_id_2",
    "@final_ref <answer_block_id> artifact=optional_id artifacts=optional_id_1,optional_id_2",
    "",
    "For multiline tool args such as file content or exact edit strings, use *_ref attrs pointing at raw blocks:",
    "@tool write_file file_path=hello.html content_ref=html_1",
    "<<<html_1:text/html",
    "<h1>Hello</h1>",
    ">>>",
    "",
    "For a long final answer, use a final answer block. The final answer must always be human-readable text, never just a node id:",
    "@final_ref final_answer artifacts=output_1,index_page",
    "<<<final_answer:text/markdown",
    "Done — I created the files and linked them from index.html.",
    ">>>",
    "",
    "For SVG, HTML, code, markdown, or any generated artifact, put raw content in a separate block. No escaping inside blocks:",
    "@node output_1 <model_chosen_type> \"Generated output\" mime=image/svg+xml",
    "@edge user_input_1 creates output_1",
    "@final_ref final_answer artifact=output_1",
    "<<<final_answer:text/markdown",
    "Done — created the SVG artifact.",
    ">>>",
    "<<<output_1:image/svg+xml",
    "<svg>raw content here</svg>",
    ">>>",
    "",
    "Keep commands small so model attention stays on the user's task.",
    "Every completed turn must include exactly one @final or @final_ref with a human-readable answer. Use artifacts= only as references, not as the answer itself.",
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
    "<FOCUS_POINTS>",
    ...focusPointLines(frame),
    "</FOCUS_POINTS>",
    "",
    "<GRAPH>"
  ];

  for (const node of frame.graph.nodes) {
    lines.push(`node ${node.id} [${node.type}]: ${node.text}${nodeDataSummary(node)}`);
  }
  for (const edge of frame.graph.edges) {
    lines.push(`edge ${edge.from} ${edge.type} ${edge.to}`);
  }
  lines.push("</GRAPH>");

  return lines.join("\n");
}

function focusPointLines(frame: GraphFrame): string[] {
  const ids = frame.frame.candidateFocusNodeIds?.length ? frame.frame.candidateFocusNodeIds : ["system_root"];
  return ids.map((id) => {
    const node = frame.graph.nodes.find((item) => item.id === id);
    if (!node) return `- ${id}`;
    const active = id === frame.frame.activeUserInputNodeId ? " active-user-input" : "";
    const focus = id === frame.frame.focusNodeId ? " focus" : "";
    return `- ${node.id} [${node.type}]${active}${focus}: ${oneLine(node.text).slice(0, 240)}`;
  });
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
