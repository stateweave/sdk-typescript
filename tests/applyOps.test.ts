import { expect, it } from "vitest";
import { applyOps, addToolResult } from "../src/core/applyOps.js";
import { createInitialGraphFrame } from "../src/core/graph.js";

it("applies add_node, add_edge, update_node, and focus ops", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [
    { op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "Token is cleared early", confidence: 0.7 } },
    { op: "add_edge", from: "hypothesis_1", to: "user_input_1", type: "addresses" },
    { op: "update_node", id: "hypothesis_1", patch: { status: "resolved" } },
    { op: "focus", currentFocus: "finalize" }
  ]);

  expect(next.graph.nodes.find((node) => node.id === "hypothesis_1")?.status).toBe("resolved");
  expect(next.graph.edges.some((edge) => edge.from === "hypothesis_1" && edge.to === "user_input_1")).toBe(true);
  expect(next.frame.currentFocus).toBe("finalize");
});

it("moves cortex focus to an explicit user input node", () => {
  const frame = createInitialGraphFrame({ objective: "Focus", input: "Start", availableActions: [] });
  const next = applyOps(frame, [{ op: "focus", nodeId: "user_input_1", currentFocus: "Work from the first user input" }]);
  expect(next.frame.focusNodeId).toBe("user_input_1");
  expect(next.frame.activeUserInputNodeId).toBe("user_input_1");
  expect(next.frame.candidateFocusNodeIds).toContain("user_input_1");
});

it("auto-connects model-added semantic nodes to the latest user input when no edge is provided", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [{ op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "Token is cleared early" } }]);
  expect(next.graph.edges.some((edge) => edge.from === "user_input_1" && edge.to === "hypothesis_1" && edge.type === "relates_to")).toBe(true);
});

it("adds assistant output nodes when final ops are applied", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [{ op: "final", answer: "Move token persistence earlier." }]);
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "assistant_output_1", type: "assistant_output", text: "Move token persistence earlier." }));
  expect(next.graph.edges.some((edge) => edge.from === "user_input_1" && edge.to === "assistant_output_1" && edge.type === "follows")).toBe(true);
  expect(next.frame.focusNodeId).toBe("assistant_output_1");
});

it("reuses a model-added assistant output node when final is also returned", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [
    { op: "add_node", node: { id: "assistant_output_custom", type: "assistant_output", text: "draft" } },
    { op: "final", answer: "final answer" }
  ]);
  expect(next.graph.nodes.filter((node) => node.type === "assistant_output")).toHaveLength(1);
  expect(next.graph.nodes.find((node) => node.id === "assistant_output_custom")?.text).toBe("final answer");
});

it("keeps large artifact final answers out of assistant output node text", () => {
  const frame = createInitialGraphFrame({ objective: "Draw SVG", input: "Make an SVG", availableActions: [] });
  const next = applyOps(frame, [
    { op: "add_node", node: { id: "artifact_1", type: "artifact", text: "SVG", data: { mime: "image/svg+xml", content: "<svg></svg>" } } },
    { op: "final", answer: "<svg></svg>", artifactId: "artifact_1" }
  ]);
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "assistant_output_1", text: "Returned artifact artifact_1", data: { artifactId: "artifact_1" } }));
  expect(next.graph.edges.some((edge) => edge.from === "assistant_output_1" && edge.to === "artifact_1" && edge.type === "creates")).toBe(true);
});

it("adds deterministic tool call and result nodes to the same graph", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const graph = addToolResult(frame.graph, { tool: "read_mock_file", result: "auth summary", step: 1 });
  expect(graph.nodes.some((node) => node.type === "tool_call")).toBe(true);
  expect(graph.nodes.some((node) => node.type === "tool_result" && node.text === "auth summary")).toBe(true);
  expect(graph.edges.some((edge) => edge.from === "user_input_1" && edge.to.startsWith("tool_call_") && edge.type === "relates_to")).toBe(true);
});
