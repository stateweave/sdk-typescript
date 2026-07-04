import { expect, it } from "vitest";
import { applyOps, addToolResult } from "../src/core/applyOps.js";
import { createInitialGraphFrame } from "../src/core/graph.js";

it("applies add_node, add_edge, update_node, and focus ops", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [
    { op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "Token is cleared early", confidence: 0.7 } },
    { op: "add_edge", from: "hypothesis_1", to: "intent_1", type: "addresses" },
    { op: "update_node", id: "hypothesis_1", patch: { status: "resolved" } },
    { op: "focus", currentFocus: "finalize" }
  ]);

  expect(next.graph.nodes.find((node) => node.id === "hypothesis_1")?.status).toBe("resolved");
  expect(next.graph.edges.some((edge) => edge.from === "hypothesis_1" && edge.to === "intent_1")).toBe(true);
  expect(next.frame.currentFocus).toBe("finalize");
});

it("auto-connects model-added nodes to the current intent when no edge is provided", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const next = applyOps(frame, [{ op: "add_node", node: { id: "hypothesis_1", type: "hypothesis", text: "Token is cleared early" } }]);
  expect(next.graph.edges.some((edge) => edge.from === "intent_1" && edge.to === "hypothesis_1" && edge.type === "relates_to")).toBe(true);
});

it("adds deterministic tool call and result nodes to the same graph", () => {
  const frame = createInitialGraphFrame({ objective: "Fix login", input: "Login fails", availableActions: [] });
  const graph = addToolResult(frame.graph, { tool: "read_mock_file", result: "auth summary", step: 1 });
  expect(graph.nodes.some((node) => node.type === "tool_call")).toBe(true);
  expect(graph.nodes.some((node) => node.type === "tool_result" && node.text === "auth summary")).toBe(true);
  expect(graph.edges.some((edge) => edge.from === "intent_1" && edge.to.startsWith("tool_call_") && edge.type === "relates_to")).toBe(true);
});
