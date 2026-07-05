import { expect, it } from "vitest";
import { applyOps, addToolResult, GraphOpsValidationError } from "../src/core/applyOps.js";
import { appendInputToGraphFrame, createInitialGraphFrame } from "../src/core/graph.js";

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

it("rejects model-added semantic nodes that are disconnected from the graph", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  expect(() => applyOps(frame, [{ op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "Token is cleared early" } }])).toThrow(GraphOpsValidationError);
});

it("rejects a second-turn answer when the pending user input was not woven into the existing graph", () => {
  const first = createInitialGraphFrame({ objective: "Draw SVG", input: "Create a butterfly", availableActions: [] });
  const frame = appendInputToGraphFrame(first, { objective: "Draw SVG", input: "Create a house" });
  expect(() => applyOps(frame, [{ op: "final", answer: "Here is a house." }])).toThrow(/pending latest user input user_input_2 is disconnected/);
});

it("accepts connected second-turn artifact output after the pending input is attached", () => {
  const first = createInitialGraphFrame({ objective: "Draw SVG", input: "Create a butterfly", availableActions: [] });
  const frame = appendInputToGraphFrame(first, { objective: "Draw SVG", input: "Create a house" });
  const next = applyOps(frame, [
    { op: "add_edge", from: "system_root", to: "user_input_2", type: "follows" },
    { op: "add_node", node: { id: "house_svg", type: "svg_artifact", text: "House SVG", data: { mime: "image/svg+xml", content: "<svg></svg>" } } },
    { op: "final", answer: "<svg></svg>", artifactId: "house_svg" }
  ]);

  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "user_input_2", type: "follows" }));
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "assistant_output_1", to: "house_svg", type: "creates" }));
});

it("applies model-chosen attachment edges for pending user inputs", () => {
  const frame = createInitialGraphFrame({ objective: "First", input: "Create snake", availableActions: [] });
  frame.graph.nodes.push({ id: "user_input_2", type: "user_input", text: "Create pacman", status: "active", createdAt: new Date(0).toISOString() });
  frame.frame.latestInputNodeId = "user_input_2";
  frame.frame.focusNodeId = "user_input_2";
  frame.frame.activeUserInputNodeId = "user_input_2";
  const next = applyOps(frame, [{ op: "add_edge", from: "system_root", to: "user_input_2", type: "follows" }]);
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "user_input_2", type: "follows" }));
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

it("keeps artifact refs separate from assistant output text", () => {
  const frame = createInitialGraphFrame({ objective: "Draw SVG", input: "Make an SVG", availableActions: [] });
  const next = applyOps(frame, [
    { op: "add_node", node: { id: "artifact_1", type: "artifact", text: "SVG", data: { mime: "image/svg+xml", content: "<svg></svg>" } } },
    { op: "final", answer: "Created the SVG.", artifactId: "artifact_1", artifactIds: ["artifact_1"] }
  ]);
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "assistant_output_1", text: "Created the SVG.", data: { artifactId: "artifact_1", artifactIds: ["artifact_1"] } }));
  expect(next.graph.edges.some((edge) => edge.from === "assistant_output_1" && edge.to === "artifact_1" && edge.type === "creates")).toBe(true);
});

it("links multiple final artifact refs from the assistant output", () => {
  const frame = createInitialGraphFrame({ objective: "Create games", input: "Make two games", availableActions: [] });
  const next = applyOps(frame, [
    { op: "add_node", node: { id: "snake", type: "artifact", text: "Snake", data: { mime: "text/html", content: "<html>Snake</html>" } } },
    { op: "add_node", node: { id: "tetris", type: "artifact", text: "Tetris", data: { mime: "text/html", content: "<html>Tetris</html>" } } },
    { op: "add_edge", from: "user_input_1", to: "snake", type: "creates" },
    { op: "add_edge", from: "user_input_1", to: "tetris", type: "creates" },
    { op: "final", answer: "Created Snake and Tetris.", artifactIds: ["snake", "tetris"] }
  ]);
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "assistant_output_1", text: "Created Snake and Tetris.", data: { artifactId: "snake", artifactIds: ["snake", "tetris"] } }));
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "assistant_output_1", to: "snake", type: "creates" }));
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "assistant_output_1", to: "tetris", type: "creates" }));
});

it("adds deterministic tool call and result nodes to the same graph", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const graph = addToolResult(frame.graph, { tool: "read_mock_file", result: "auth summary", step: 1 });
  expect(graph.nodes.some((node) => node.type === "tool_call")).toBe(true);
  expect(graph.nodes.some((node) => node.type === "tool_result" && node.text === "auth summary")).toBe(true);
  expect(graph.edges.some((edge) => edge.from === "user_input_1" && edge.to.startsWith("tool_call_") && edge.type === "relates_to")).toBe(true);
});
