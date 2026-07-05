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
    "Allowed node types: system, user_input, assistant_output, artifact, intent, constraint, fact, hypothesis, decision, tool_call, tool_result, test_result, patch, risk, question.",
    "Allowed edge types: follows, creates, supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to.",
    "Allowed statuses: active, resolved, rejected, stale.",
    "",
    "Current GraphFrame:",
    "<FRAME>",
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `nextExpectedOutput: ${frame.frame.nextExpectedOutput}`,
    "activeConstraints:",
    ...frame.frame.activeConstraints.map((c) => `- ${c}`),
    "availableActions:",
    ...frame.frame.availableActions.map((a) => `- ${a}`),
    "</FRAME>",
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
