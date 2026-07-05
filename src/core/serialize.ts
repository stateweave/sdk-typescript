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
    "@focus \"short next focus\"",
    "@tool <tool_name> key=value",
    "@final \"short final answer\" OR @final <artifact_id>",
    "",
    "For SVG, HTML, code, markdown, or any long answer, put raw content in a block. No escaping inside blocks:",
    "@node artifact_1 artifact \"Generated artifact\" mime=image/svg+xml",
    "@edge user_input_1 creates artifact_1",
    "@final artifact_1",
    "<<<artifact_1:image/svg+xml",
    "<svg>raw content here</svg>",
    ">>>",
    "",
    "Keep commands small so model attention stays on the user's task.",
    "Cortex rules:",
    "- The StateGraph is non-linear working memory, not a transcript. Use the relevant node/branch as attention.",
    "- If the user asks for a new branch/thread/fresh start, create a branch node from system_root and focus it: @node branch_N branch \"...\"; @edge system_root supports branch_N; @focus branch_N \"reason\".",
    "- If the current frame says a branch was already created for this turn, use/focus that branch instead of creating a duplicate.",
    "- If the user returns to an older topic, focus or connect to that older node instead of appending blindly to the latest message.",
    "- Mark outdated facts stale/rejected with @update; connect contradictions, dependencies, and merges explicitly.",
    "- Use @focus <node_id> \"short reason\" whenever the active graph region should move.",
    "Allowed node types: system, user_input, assistant_output, artifact, branch, intent, constraint, fact, hypothesis, decision, tool_call, tool_result, test_result, patch, risk, question.",
    "Allowed edge types: follows, creates, supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to.",
    "Allowed statuses: active, resolved, rejected, stale.",
    "",
    "Current GraphFrame:",
    "<FRAME>",
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `focusNodeId: ${frame.frame.focusNodeId ?? "unknown"}`,
    `latestInputNodeId: ${frame.frame.latestInputNodeId ?? latestNodeId(frame, "user_input") ?? "unknown"}`,
    `activeBranchNodeId: ${frame.frame.activeBranchNodeId ?? "system_root"}`,
    `candidateBranchNodeIds: ${(frame.frame.candidateBranchNodeIds ?? ["system_root"]).join(", ")}`,
    `nextExpectedOutput: ${frame.frame.nextExpectedOutput}`,
    "activeConstraints:",
    ...frame.frame.activeConstraints.map((c) => `- ${c}`),
    "availableActions:",
    ...frame.frame.availableActions.map((a) => `- ${a}`),
    "</FRAME>",
    "",
    "<BRANCH_POINTS>",
    ...branchPointLines(frame),
    "</BRANCH_POINTS>",
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

function branchPointLines(frame: GraphFrame): string[] {
  const ids = frame.frame.candidateBranchNodeIds?.length ? frame.frame.candidateBranchNodeIds : ["system_root"];
  return ids.map((id) => {
    const node = frame.graph.nodes.find((item) => item.id === id);
    if (!node) return `- ${id}`;
    const active = id === frame.frame.activeBranchNodeId ? " active" : "";
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
