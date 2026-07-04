import type { GraphFrame } from "./types.js";

export function serializeGraphFrame(frame: GraphFrame): string {
  const lines: string[] = [
    "You are operating inside StateWeave.",
    "",
    "You do not return a normal assistant message.",
    "",
    "You return JSON GraphOps only.",
    "The model must return only valid JSON. No markdown. No prose outside JSON.",
    "",
    "The current GraphFrame is:",
    "",
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
    const details = node.data ? ` data=${JSON.stringify(node.data)}` : "";
    lines.push(`node ${node.id} [${node.type}]: ${node.text}${details}`);
  }
  for (const edge of frame.graph.edges) {
    lines.push(`edge ${edge.from} ${edge.type} ${edge.to}`);
  }
  lines.push(
    "</GRAPH>",
    "",
    "Return exactly one JSON object with an ops array. Each item must use the `op` field, never `action`.",
    "",
    "Allowed edge types: supports, contradicts, explains, depends_on, addresses, validates, constrains, causes, relates_to. If unsure, use supports or explains. Never invent edge types.",
    "Allowed node types: intent, constraint, fact, hypothesis, decision, tool_call, tool_result, test_result, patch, risk, question.",
    "Allowed node statuses: active, resolved, rejected, stale. Never invent status values.",
    "",
    "Allowed operation shapes:",
    JSON.stringify(
      {
        ops: [
          { op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "...", confidence: 0.7, status: "active" } },
          { op: "add_edge", from: "fact_1", to: "intent_1", type: "supports" },
          { op: "update_node", id: "fact_1", patch: { status: "resolved" } },
          { op: "focus", currentFocus: "..." },
          { op: "call_tool", tool: "read_mock_file", args: { path: "auth.ts" } },
          { op: "final", answer: "..." }
        ]
      },
      null,
      2
    )
  );

  return lines.join("\n");
}
