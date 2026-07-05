import { expect, it } from "vitest";
import { appendInputToGraphFrame, createInitialGraphFrame } from "../src/core/graph.js";
import { serializeGraphFrame } from "../src/core/serialize.js";

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

it("appends new input to the current cortex focus", () => {
  const frame = createInitialGraphFrame({ objective: "Remember my name", input: "Hi my name is Radi.", availableActions: [] });
  const next = appendInputToGraphFrame(frame, { objective: "What is my name?", input: "What is my name?" });
  expect(next.frame.objective).toBe("What is my name?");
  expect(next.frame.focusNodeId).toBe("user_input_2");
  expect(next.graph.nodes.some((node) => node.text === "Hi my name is Radi.")).toBe(true);
  expect(next.graph.nodes.some((node) => node.text === "What is my name?")).toBe(true);
  expect(next.graph.edges.some((edge) => edge.from === "user_input_1" && edge.to === "user_input_2" && edge.type === "follows")).toBe(true);
});

it("creates a cortex branch from system_root when the user asks for a fresh branch", () => {
  const frame = createInitialGraphFrame({ objective: "First topic", input: "Talk about apples.", availableActions: [] });
  const next = appendInputToGraphFrame(frame, { objective: "New branch", input: "Start a new branch for physics notes." });
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "branch_1", type: "branch" }));
  expect(next.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_2", data: { branchId: "branch_1" } }));
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "branch_1", type: "supports" }));
  expect(next.graph.edges).toContainEqual(expect.objectContaining({ from: "branch_1", to: "user_input_2", type: "follows" }));
  expect(next.frame.activeBranchNodeId).toBe("branch_1");
  expect(next.frame.focusNodeId).toBe("user_input_2");
});
