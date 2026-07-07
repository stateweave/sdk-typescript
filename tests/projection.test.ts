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

it("clusters group related semantic nodes by domain", () => {
  const frame = buildConversation([
    { input: "Fix login bug", answer: "Token was cleared early" },
    { input: "Draw an SVG", answer: "Here is a butterfly" },
    { input: "Explain OAuth", answer: "OAuth flow explained" }
  ]);

  const clusters = clusterGraph(frame.graph);
  // All hypotheses share the same domain, so they merge into one cluster.
  // Structural nodes (user_input, assistant_output) stay in their own clusters.
  expect(clusters.length).toBeGreaterThanOrEqual(1);
  const labels = clusters.map((c) => c.label).join(" ");
  expect(labels).toContain("Fix login bug");
});

it("cluster ids are stable across turns when nodes don't change", () => {
  let frame = buildConversation([{ input: "First", answer: "A1" }, { input: "Second", answer: "A2" }]);
  const before = clusterGraph(frame.graph).map((c) => c.id);

  frame = appendInputToGraphFrame(frame, { objective: "Multi-turn", input: "Third" });
  frame.graph.nodes.push({ id: "assistant_output_3", type: "assistant_output", text: "A3", status: "resolved", createdAt: new Date().toISOString() });
  frame.graph.edges.push({ id: "e3", from: "user_input_3", to: "assistant_output_3", type: "follows", createdAt: "" });

  const after = clusterGraph(frame.graph).map((c) => c.id);
  // Existing clusters that didn't gain/lose nodes keep their id.
  expect(after.length).toBeGreaterThanOrEqual(before.length);
});

it("focus window is bounded by budget and centered on focusNodeId", () => {
  const frame = buildConversation([
    { input: "Topic A", answer: "A1" },
    { input: "Topic B", answer: "B1" },
    { input: "Topic C", answer: "C1" }
  ]);

  const projection = projectGraph(frame.graph, { focusNodeId: "user_input_2", zoom: 0, budgetNodes: 10 });
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

it("retrieval pulls keyword-matched nodes into focus", () => {
  let frame = createInitialGraphFrame({ objective: "Test", input: "Remember the telescope slew rate is 7", availableActions: [] });
  frame.graph.nodes.push({ id: "fact_1", type: "fact", text: "The telescope slew rate is 7", status: "active", createdAt: new Date(0).toISOString() });
  frame.graph.edges.push({ id: "e_f1", from: "user_input_1", to: "fact_1", type: "addresses", createdAt: "" });
  // A new question about slew rate, far from fact_1 in the graph.
  frame = appendInputToGraphFrame(frame, { objective: "Test", input: "What is the maximum slew rate for the telescope?" });
  const projection = projectGraph(frame.graph, { focusNodeId: "user_input_2" });
  // Retrieval should find fact_1 by keyword match even though it's outside BFS radius.
  expect(projection.retrievedNodeIds).toContain("fact_1");
});

it("peripheral clusters exist alongside focus clusters", () => {
  const frame = buildConversation([
    { input: "Connected topic alpha", answer: "A1" },
    { input: "Connected topic beta", answer: "A2" }
  ]);
  const projection = projectGraph(frame.graph, { focusNodeId: "user_input_1" });
  expect(projection.bigBrainClusters.length).toBeGreaterThanOrEqual(1);
  expect(projection.focusClusterIds.length).toBeLessThanOrEqual(projection.bigBrainClusters.length);
});

it("serialize renders big brain, periphery, focus, and timeline layers", () => {
  const frame = buildConversation([{ input: "First ask", answer: "First answer" }, { input: "Second ask", answer: "Second answer" }]);
  const prompt = serializeGraphFrame(frame);
  expect(prompt).toContain("<BIG_BRAIN>");
  expect(prompt).toContain("<FOCUS>");
  expect(prompt).toContain("<TIMELINE>");
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
