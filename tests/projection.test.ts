import { expect, it } from "vitest";
import { appendInputToGraphFrame, createInitialGraphFrame } from "../src/core/graph.js";
import { clusterGraph, projectGraph } from "../src/core/projection.js";
import { serializeGraphFrame } from "../src/core/serialize.js";

function buildConversation(turns: { input: string; answer: string }[]) {
  let frame = createInitialGraphFrame({ objective: "Multi-turn", input: turns[0].input, availableActions: [] });
  let inputCounter = 1;
  let assistantCounter = 1;
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (index > 0) {
      frame = appendInputToGraphFrame(frame, { objective: "Multi-turn", input: turn.input });
      inputCounter += 1;
    }
    const hypothesisId = `hypothesis_${inputCounter}`;
    const answerId = `assistant_output_${assistantCounter}`;
    frame.graph.nodes.push({ id: hypothesisId, type: "hypothesis", text: `Why turn ${inputCounter}`, status: "active", createdAt: new Date(index * 1000).toISOString() });
    frame.graph.nodes.push({ id: answerId, type: "assistant_output", text: turn.answer, status: "resolved", createdAt: new Date(index * 1000 + 500).toISOString() });
    frame.graph.edges.push({ id: `e_${inputCounter}_h`, from: `user_input_${inputCounter}`, to: hypothesisId, type: "addresses", createdAt: "" });
    frame.graph.edges.push({ id: `e_${inputCounter}_a`, from: `user_input_${inputCounter}`, to: answerId, type: "follows", createdAt: "" });
    assistantCounter += 1;
  }
  return frame;
}

it("clusters one topic per user_input turn", () => {
  const frame = buildConversation([
    { input: "Fix login bug", answer: "Token was cleared early" },
    { input: "Draw an SVG", answer: "Here is a butterfly" },
    { input: "Explain OAuth", answer: "OAuth flow explained" }
  ]);

  const clusters = clusterGraph(frame.graph);
  expect(clusters.length).toBe(3);
  expect(clusters[0].label).toContain("Fix login bug");
  expect(clusters[1].label).toContain("Draw an SVG");
});

it("cluster ids are stable across turns", () => {
  let frame = buildConversation([{ input: "First", answer: "A1" }, { input: "Second", answer: "A2" }]);
  const before = clusterGraph(frame.graph).map((c) => c.id);

  frame = appendInputToGraphFrame(frame, { objective: "Multi-turn", input: "Third" });
  frame.graph.nodes.push({ id: "assistant_output_3", type: "assistant_output", text: "A3", status: "resolved", createdAt: new Date().toISOString() });
  frame.graph.edges.push({ id: "e3", from: "user_input_3", to: "assistant_output_3", type: "follows", createdAt: "" });

  const after = clusterGraph(frame.graph).map((c) => c.id);
  expect(after.slice(0, before.length)).toEqual(before);
});

it("focus window is bounded by budget and centered on focusNodeId", () => {
  const frame = buildConversation([
    { input: "Topic A", answer: "A1" },
    { input: "Topic B", answer: "B1" },
    { input: "Topic C", answer: "C1" }
  ]);

  const projection = projectGraph(frame.graph, { focusNodeId: "user_input_2", zoom: 0, budgetNodes: 6 });
  expect(projection.focusNodes.length).toBeLessThanOrEqual(6);
  expect(projection.focusNodes.some((n) => n.id === "user_input_2")).toBe(true);
  expect(projection.focusNodes.some((n) => n.id === "system_root")).toBe(true);
});

it("higher zoom shrinks the focus window", () => {
  const frame = buildConversation([
    { input: "T1", answer: "A1" },
    { input: "T2", answer: "A2" },
    { input: "T3", answer: "A3" }
  ]);
  const tight = projectGraph(frame.graph, { zoom: 0 }).focusNodes.length;
  const wide = projectGraph(frame.graph, { zoom: 3 }).focusNodes.length;
  expect(wide).toBeLessThanOrEqual(tight);
});

it("peripheral clusters are those adjacent to but outside focus", () => {
  const frame = buildConversation([
    { input: "Connected topic", answer: "A1" },
    { input: "Far topic", answer: "A2" }
  ]);
  const projection = projectGraph(frame.graph, { focusNodeId: "user_input_1" });
  expect(projection.bigBrainClusters.length).toBeGreaterThanOrEqual(2);
  expect(projection.focusClusterIds.length).toBeLessThanOrEqual(projection.bigBrainClusters.length);
});

it("serialize renders big brain, periphery, and focus layers", () => {
  const frame = buildConversation([{ input: "First ask", answer: "First answer" }, { input: "Second ask", answer: "Second answer" }]);
  const prompt = serializeGraphFrame(frame);
  expect(prompt).toContain("<BIG_BRAIN>");
  expect(prompt).toContain("<FOCUS>");
  expect(prompt).toContain("cluster_");
  expect(prompt).toContain("node system_root [system]");
  expect(prompt).toContain("node user_input_1 [user_input]");
});

it("small graph still renders all nodes in focus", () => {
  const frame = createInitialGraphFrame({ objective: "Tiny", input: "Hello", availableActions: [] });
  const prompt = serializeGraphFrame(frame);
  expect(prompt).toContain("node system_root [system]");
  expect(prompt).toContain("node user_input_1 [user_input]");
});
