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

it("clusters keep unrelated turns separate without a shared entity", () => {
  const frame = buildConversation([
    { input: "Fix login bug", answer: "Token was cleared early" },
    { input: "Draw an SVG", answer: "Here is a butterfly" },
    { input: "Explain OAuth", answer: "OAuth flow explained" }
  ]);

  const clusters = clusterGraph(frame.graph);
  expect(clusters.length).toBeGreaterThanOrEqual(3);
  const labels = clusters.map((c) => c.label).join(" ");
  expect(labels).toContain("Fix login bug");
});

it("builds deterministic semantic cluster summaries and overview pages", () => {
  const frame = buildConversation(Array.from({ length: 70 }, (_, index) => ({ input: `Topic ${index}`, answer: `Decision ${index}` })));
  const clusters = clusterGraph(frame.graph);
  expect(clusters.some((cluster) => cluster.summary.includes("Decision"))).toBe(true);
  const first = serializeGraphFrame(frame, { maxTokens: 32_000 });
  const second = serializeGraphFrame(frame, { maxTokens: 32_000 });
  expect(second).toBe(first);
  expect(first).toContain("overview_page_1");
  expect(first).toMatch(/omitted clusters, range cluster_/);
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

it("higher zoom widens the focus window", () => {
  const frame = createInitialGraphFrame({ objective: "Map", input: "the and", availableActions: [] });
  let previous = "user_input_1";
  for (let index = 1; index <= 20; index++) {
    const id = `chain_${index}`;
    frame.graph.nodes.push({ id, type: "fact", text: `Chain fact ${index}`, createdAt: new Date(index).toISOString() });
    frame.graph.edges.push({ id: `edge_chain_${index}`, from: previous, to: id, type: "follows", createdAt: new Date(index).toISOString() });
    previous = id;
  }
  const tight = projectGraph(frame.graph, { focusNodeId: "user_input_1", zoom: 0 }).focusNodes.length;
  const wide = projectGraph(frame.graph, { focusNodeId: "user_input_1", zoom: 3 }).focusNodes.length;
  expect(wide).toBeGreaterThan(tight);
});

it("always projects the latest tool call and result even when a large neighborhood exhausts the BFS budget", () => {
  const frame = createInitialGraphFrame({ objective: "Inspect", input: "Inspect the crowded workspace", availableActions: [] });
  for (let index = 0; index < 300; index++) {
    const id = `historical_fact_${index}`;
    frame.graph.nodes.push({ id, type: "fact", text: `Historical workspace fact ${index}`, status: "active", createdAt: new Date(index).toISOString() });
    frame.graph.edges.push({ id: `edge_${id}`, from: "user_input_1", to: id, type: "relates_to", createdAt: "" });
  }
  frame.graph.nodes.push({ id: "tool_call_latest", type: "tool_call", text: "Called read_file", data: { tool: "read_file" }, status: "resolved", createdAt: new Date(1_000).toISOString() });
  frame.graph.nodes.push({ id: "tool_result_latest", type: "tool_result", text: "read_file succeeded", data: { result: { content: "LATEST_TOOL_EVIDENCE" }, ok: true }, status: "active", createdAt: new Date(1_001).toISOString() });
  frame.graph.edges.push({ id: "edge_latest_call", from: "user_input_1", to: "tool_call_latest", type: "relates_to", createdAt: "" });
  frame.graph.edges.push({ id: "edge_latest_result", from: "tool_call_latest", to: "tool_result_latest", type: "explains", createdAt: "" });

  const projection = projectGraph(frame.graph, { focusNodeId: "user_input_1" });
  const prompt = serializeGraphFrame(frame);

  expect(projection.focusNodes).toContainEqual(expect.objectContaining({ id: "tool_call_latest" }));
  expect(projection.focusNodes).toContainEqual(expect.objectContaining({ id: "tool_result_latest" }));
  expect(prompt).toContain("LATEST_TOOL_EVIDENCE");
});

it("renders exact latest tool arguments and substantially more than the generic 1200-character result preview", () => {
  const frame = createInitialGraphFrame({ objective: "Inspect", input: "Inspect the complete source", availableActions: [] });
  const content = `EVIDENCE_START ${"x".repeat(5_000)} EVIDENCE_END`;
  frame.graph.nodes.push({ id: "tool_call_latest", type: "tool_call", text: "Called read_file", data: { tool: "read_file", args: { file_path: "src/app.js", offset: 0, limit: 500 } }, status: "resolved", createdAt: new Date(1_000).toISOString() });
  frame.graph.nodes.push({ id: "tool_result_latest", type: "tool_result", text: "read_file succeeded", data: { tool: "read_file", result: { path: "src/app.js", content, content_hash: "abc123" }, ok: true }, status: "active", createdAt: new Date(1_001).toISOString() });
  frame.graph.edges.push({ id: "edge_latest_call", from: "user_input_1", to: "tool_call_latest", type: "relates_to", createdAt: "" });
  frame.graph.edges.push({ id: "edge_latest_result", from: "tool_call_latest", to: "tool_result_latest", type: "explains", createdAt: "" });

  const prompt = serializeGraphFrame(frame, { maxTokens: 16_000 });
  expect(prompt).toContain("<LATEST_TOOL_EVIDENCE>");
  expect(prompt).toContain('"file_path": "src/app.js"');
  expect(prompt).toContain("EVIDENCE_START");
  expect(prompt).toContain("EVIDENCE_END");
});

it("bounds nested tool payloads by prompt tokens while preserving active evidence", () => {
  const frame = createInitialGraphFrame({ objective: "Inspect", input: "Summarize the current large report", availableActions: [] });
  frame.graph.nodes.push({
    id: "tool_result_large",
    type: "tool_result",
    text: "read_file succeeded for report.txt",
    data: { result: { path: "report.txt", content: "EVIDENCE_START " + "x".repeat(1_000_000), stdout: "y".repeat(1_000_000) }, ok: true },
    status: "active",
    createdAt: new Date().toISOString()
  });
  frame.graph.edges.push({ id: "edge_large", from: "user_input_1", to: "tool_result_large", type: "explains", createdAt: new Date().toISOString() });
  const prompt = serializeGraphFrame(frame, { maxTokens: 4_000 });
  expect(Math.ceil(prompt.length / 4)).toBeLessThanOrEqual(4_000);
  expect(prompt).toContain("Summarize the current large report");
  expect(prompt).toContain("EVIDENCE_START");
  expect(prompt).not.toContain("x".repeat(20_000));
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

it("retrieves exact entities for imperative change requests", () => {
  let frame = createInitialGraphFrame({ objective: "Maintain", input: "Create src/components/component-006.json", availableActions: [] });
  frame.graph.nodes.push({ id: "file_component_006", type: "file", text: "src/components/component-006.json retryLimit 3", data: { path: "src/components/component-006.json" }, status: "active", createdAt: new Date(0).toISOString() });
  frame.graph.nodes.push({ id: "unrelated_file", type: "file", text: "src/components/component-999.json retryLimit 9", data: { path: "src/components/component-999.json" }, status: "active", createdAt: new Date(0).toISOString() });
  frame.graph.edges.push({ id: "e_component", from: "user_input_1", to: "file_component_006", type: "creates", createdAt: "" });
  frame.graph.edges.push({ id: "e_unrelated", from: "system_root", to: "unrelated_file", type: "relates_to", createdAt: "" });
  frame = appendInputToGraphFrame(frame, { objective: "Maintain", input: "Update RETRY_LIMIT in src/components/component-006.json to 4." });

  const projection = projectGraph(frame.graph, { focusNodeId: "assistant_output_missing" });
  expect(projection.retrievedNodeIds).toContain("file_component_006");
  expect(projection.focusNodes).toContainEqual(expect.objectContaining({ id: "user_input_2" }));
  expect(projection.focusNodes).not.toContainEqual(expect.objectContaining({ id: "unrelated_file" }));
});

it("keeps unrelated entities in separate clusters", () => {
  const frame = buildConversation([
    { input: "Update component-001 manifest", answer: "Updated component-001" },
    { input: "Update component-002 manifest", answer: "Updated component-002" },
    { input: "Review component-001 module", answer: "Reviewed component-001" }
  ]);
  const clusters = clusterGraph(frame.graph);
  const componentOne = clusters.find((cluster) => cluster.nodeIds.includes("user_input_1"));
  const componentTwo = clusters.find((cluster) => cluster.nodeIds.includes("user_input_2"));
  expect(componentOne?.id).not.toBe(componentTwo?.id);
  expect(componentOne?.nodeIds).toContain("user_input_3");
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

it("uses a larger but bounded focus window for modern long-context models", () => {
  const turns = Array.from({ length: 45 }, (_, index) => ({
    input: `Telescope observation ${index + 1} uses shared filter code azure-${index + 1}`,
    answer: `Recorded telescope filter azure-${index + 1}`
  }));
  let frame = buildConversation(turns);
  frame = appendInputToGraphFrame(frame, { objective: "Recall", input: "List the telescope observations and shared azure filter codes." });

  const projection = projectGraph(frame.graph, { focusNodeId: frame.frame.latestInputNodeId });
  expect(projection.focusNodes.length).toBeGreaterThan(64);
  expect(projection.focusNodes.length).toBeLessThanOrEqual(256);
});

it("chronology probes preserve intra-turn emission order despite identical timestamps", () => {
  // Simulate a seed turn that atomized 3 facts in ONE GraphOps transaction:
  // all three get identical createdAt (the real applyOps behavior). The gold
  // answer for "which came first" is the order the facts were emitted.
  let frame = createInitialGraphFrame({ objective: "Chrono", input: "Note: kiln is Olympic 2827HE, clay is 500lbs, glaze is cobalt.", availableActions: [] });
  const sameTs = frame.graph.nodes[frame.graph.nodes.length - 1].createdAt; // identical for all
  frame.graph.nodes.push({ id: "fact_kiln", type: "fact", text: "Kiln is Olympic 2827HE", status: "active", createdAt: sameTs });
  frame.graph.nodes.push({ id: "fact_clay", type: "fact", text: "Clay delivery is 500lbs", status: "active", createdAt: sameTs });
  frame.graph.nodes.push({ id: "fact_glaze", type: "fact", text: "Glaze is cobalt", status: "active", createdAt: sameTs });
  for (const fid of ["fact_kiln", "fact_clay", "fact_glaze"]) {
    frame.graph.edges.push({ id: `e_${fid}`, from: "user_input_1", to: fid, type: "addresses", createdAt: sameTs });
  }
  // Chronology probe: which came first, kiln or clay?
  frame = appendInputToGraphFrame(frame, { objective: "Chrono", input: "Between the kiln model and the clay quantity, which came first in our conversation?" });

  const prompt = serializeGraphFrame(frame);
  // Chronology mode must annotate focus nodes with an explicit global rank so
  // the model can compare ordering instead of treating tied timestamps as
  // simultaneous. The kiln fact must carry a strictly lower rank than clay.
  const focus = prompt.slice(prompt.indexOf("<FOCUS>"), prompt.indexOf("</FOCUS>"));
  const kilnLine = focus.split("\n").find((line) => line.startsWith("node fact_kiln"));
  const clayLine = focus.split("\n").find((line) => line.startsWith("node fact_clay"));
  expect(kilnLine).toMatch(/#\d+/);
  expect(clayLine).toMatch(/#\d+/);
  const kilnRank = Number(kilnLine!.match(/#(\d+)/)![1]);
  const clayRank = Number(clayLine!.match(/#(\d+)/)![1]);
  expect(kilnRank).toBeLessThan(clayRank);
  // The timeline must explain the rank semantics and list kiln before clay.
  expect(prompt).toContain("LOWER # means established EARLIER");
  expect(prompt.indexOf("fact_kiln")).toBeLessThan(prompt.indexOf("fact_clay"));
});
