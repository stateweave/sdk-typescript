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

it("rejects add_node identifiers that collide with existing or transaction nodes", () => {
  const frame = createInitialGraphFrame({ objective: "Identity", input: "Keep identity sound", availableActions: [] });
  expect(() => applyOps(frame, [{ op: "add_node", node: { id: "system_root", type: "fact", text: "collision" } }])).toThrow(/collides with an existing node/);
  expect(() => applyOps(frame, [
    { op: "add_node", node: { id: "fact_1", type: "fact", text: "one" } },
    { op: "add_node", node: { id: "fact_1", type: "fact", text: "two" } }
  ])).toThrow(/declared more than once/);
});

it("moves cortex focus to an explicit user input node", () => {
  const frame = createInitialGraphFrame({ objective: "Focus", input: "Start", availableActions: [] });
  const next = applyOps(frame, [{ op: "focus", nodeId: "user_input_1", currentFocus: "Work from the first user input" }]);
  expect(next.frame.focusNodeId).toBe("user_input_1");
  expect(next.frame.activeUserInputNodeId).toBe("user_input_1");
  expect(next.frame.candidateFocusNodeIds).toContain("user_input_1");
});

it("automatically connects model-added semantic nodes to the active input", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [{ op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "Token is cleared early" } }]);
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "user_input_1", to: "hypothesis_1", type: "relates_to" }));
});

it("applies @zoom to set the vision level", () => {
  const frame = createInitialGraphFrame({ objective: "Zoom", input: "See the map", availableActions: [] });
  const next = applyOps(frame, [{ op: "zoom", level: 2 }]);
  expect(next.frame.zoom).toBe(2);
});

it("rejects workers focused on missing nodes", () => {
  const frame = createInitialGraphFrame({ objective: "Work", input: "Plan", availableActions: [] });
  expect(() => applyOps(frame, [{ op: "spawn_worker", id: "missing", objective: "Do work", focusNodeId: "missing_node" }])).toThrow(GraphOpsValidationError);
});

it("automatically weaves a pending second-turn input into the existing graph", () => {
  const first = createInitialGraphFrame({ objective: "Draw SVG", input: "Create a butterfly", availableActions: [] });
  const frame = appendInputToGraphFrame(first, { objective: "Draw SVG", input: "Create a house" });
  const next = applyOps(frame, [{ op: "final", answer: "Here is a house." }]);
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "user_input_2", type: "follows" }));
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

it("surfaces structured acceptance failures in tool evidence", () => {
  const frame = createInitialGraphFrame({ objective: "Release comments", input: "Release R002", availableActions: [] });
  const graph = addToolResult(frame.graph, {
    tool: "app_control",
    result: { ok: false, acceptance: { ok: false, details: ["backend and frontend documented"] } },
    step: 1,
    ok: false
  });
  expect(graph.nodes).toContainEqual(expect.objectContaining({
    type: "tool_result",
    text: "app_control failed: acceptance criteria not met: backend and frontend documented",
    status: "rejected"
  }));
});

it("preserves bounded tool arguments needed to interpret later results", () => {
  const frame = createInitialGraphFrame({ objective: "Inspect", input: "Run a check", availableActions: [] });
  const graph = addToolResult(frame.graph, {
    tool: "bash_command",
    toolArgs: { command: "npm test 2>&1 | tail -40", content: "x".repeat(5_000) },
    result: { exitCode: 1, stderr: "test failed" },
    step: 1,
    ok: false
  });
  const call = graph.nodes.find((node) => node.type === "tool_call");
  expect(call?.data).toMatchObject({ tool: "bash_command", args: { command: "npm test 2>&1 | tail -40", content: { chars: 5_000 } } });
  expect(JSON.stringify(call?.data)).not.toContain("x".repeat(2_000));
});

it("adds deterministic tool evidence and versions canonical file state", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  let graph = addToolResult(frame.graph, { tool: "read_file", result: { file_path: "config.json", content_hash: "aaaaaaaaaaaaaaaa" }, step: 1 });
  graph = addToolResult(graph, { tool: "edit_file", result: { file_path: "config.json", content_hash: "bbbbbbbbbbbbbbbb" }, step: 2 });
  expect(graph.nodes.some((node) => node.type === "tool_call")).toBe(true);
  expect(graph.nodes.filter((node) => node.type === "file" && node.status === "stale")).toHaveLength(1);
  expect(graph.nodes).toContainEqual(expect.objectContaining({ type: "file", status: "active", data: expect.objectContaining({ path: "config.json", contentHash: "bbbbbbbbbbbbbbbb", canonical: true }) }));
  expect(graph.edges.some((edge) => edge.from === "user_input_1" && edge.to.startsWith("tool_call_") && edge.type === "relates_to")).toBe(true);
});
