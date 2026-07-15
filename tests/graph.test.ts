import { expect, it } from "vitest";
import { appendInputToGraphFrame, assertValidGraphFrame, createInitialGraphFrame } from "../src/core/graph.js";
import { serializeGraphFrame } from "../src/core/serialize.js";

it("creates a system-only initial GraphFrame when no user input is provided", () => {
  const frame = createInitialGraphFrame({ objective: "Bootstrap", systemPrompt: "Be careful.", availableActions: [] });
  expect(frame.graph.nodes).toContainEqual(expect.objectContaining({ id: "system_root", type: "system", text: "Be careful." }));
  expect(frame.graph.nodes.some((node) => node.type === "user_input")).toBe(false);
  expect(frame.frame.focusNodeId).toBe("system_root");
  expect(frame.frame.latestInputNodeId).toBeUndefined();
});

it("creates an initial GraphFrame with a system root and first user input", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails. Do not rewrite auth.", availableActions: ["read_mock_file"] });
  expect(frame.frame.objective).toBe("Fix login");
  expect(frame.graph.nodes.map((node) => node.type)).toEqual(["system", "user_input"]);
  expect(frame.graph.edges).toEqual([expect.objectContaining({ from: "system_root", to: "user_input_1", type: "follows" })]);
  expect(frame.frame.activeConstraints[0]).toMatch(/do not rewrite/i);
});

it("serializes a GraphFrame into the StateWeave prompt contract", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const prompt = serializeGraphFrame(frame);
  expect(prompt).toContain("You are operating inside StateWeave.");
  expect(prompt).toContain("provider messages[]");
  expect(prompt).toContain("Return StateWeave Exchange");
  expect(prompt).toContain("SWX/1");
  expect(prompt).toContain("node system_root [system]");
  expect(prompt).toContain("node user_input_1 [user_input]");
});

it("serializes configured semantic node type hints", () => {
  const frame = createInitialGraphFrame({ objective: "Plan", input: "Plan the work", availableActions: [], nodeTypes: ["intent", "constraint", "artifact"] });
  const prompt = serializeGraphFrame(frame);
  expect(frame.frame.nodeTypes).toEqual(["intent", "constraint", "artifact"]);
  expect(prompt).toContain("semanticNodeTypes:\n- intent\n- constraint\n- artifact");
});

it("appends new input as the active cortex node for deterministic attachment", () => {
  const frame = createInitialGraphFrame({ objective: "Remember my name", input: "Hi my name is Radi.", availableActions: [] });
  const next = appendInputToGraphFrame(frame, { objective: "What is my name?", input: "What is my name?" });
  expect(next.frame.objective).toBe("What is my name?");
  expect(next.frame.focusNodeId).toBe("user_input_2");
  expect(next.graph.nodes.some((node) => node.text === "Hi my name is Radi.")).toBe(true);
  expect(next.graph.nodes.some((node) => node.text === "What is my name?")).toBe(true);
  expect(next.graph.edges.some((edge) => edge.from === "user_input_1" && edge.to === "user_input_2")).toBe(false);
  expect(next.frame.currentFocus).toMatch(/attach this user_input structurally/i);
});

it("allocates the next unused input suffix in an imported graph with gaps", () => {
  const frame = createInitialGraphFrame({ objective: "One", input: "One", availableActions: [] });
  frame.graph.nodes.push({ id: "user_input_3", type: "user_input", text: "Three", createdAt: new Date().toISOString() });
  frame.graph.edges.push({ id: "edge_gap", from: "system_root", to: "user_input_3", type: "follows", createdAt: new Date().toISOString() });
  const next = appendInputToGraphFrame(frame, { objective: "Four", input: "Four" });
  expect(next.frame.latestInputNodeId).toBe("user_input_4");
});

it("rejects malformed imported graph identity and references", () => {
  const frame = createInitialGraphFrame({ objective: "One", input: "One", availableActions: [] });
  frame.graph.nodes.push({ ...frame.graph.nodes[1]! });
  frame.graph.edges.push({ id: "bad", from: "missing", to: "user_input_1", type: "follows", createdAt: new Date().toISOString() });
  expect(() => assertValidGraphFrame(frame)).toThrow(/duplicate node id user_input_1.*missing from node missing/);
});

it("does not hard-code fresh branch attachment before the model weaves the input", () => {
  const frame = createInitialGraphFrame({ objective: "First topic", input: "Talk about apples.", availableActions: [] });
  const next = appendInputToGraphFrame(frame, { objective: "Fresh context", input: "Start a new branch for physics notes." });
  expect(next.graph.nodes.some((node) => node.id.startsWith("branch_"))).toBe(false);
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_2", type: "user_input" }));
  expect(next.graph.nodes.find((node) => node.id === "user_input_2")?.data).toBeUndefined();
  expect(next.graph.edges.some((edge) => edge.to === "user_input_2")).toBe(false);
  expect(next.frame.activeUserInputNodeId).toBe("user_input_2");
  expect(next.frame.focusNodeId).toBe("user_input_2");
  expect(next.frame.candidateFocusNodeIds).toEqual(["system_root", "user_input_2", "user_input_1"]);
});
