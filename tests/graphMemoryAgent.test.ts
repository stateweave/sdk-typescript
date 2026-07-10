import { expect, it } from "vitest";
import { GraphMemoryAgent } from "../src/evals/graphMemoryAgent.js";
import type { Model, ModelInput, ModelToken } from "../src/llm/model.js";

it("uses one call per turn and applies answer plus GraphOps to persistent graph state", async () => {
  const prompts: string[] = [];
  const outputs = [
    ["SWX/1", "@edge system_root follows user_input_1", '@node fact_scope fact "The telescope model is Celestron NexStar 8SE" status=active confidence=1', "@edge user_input_1 creates fact_scope", '@final "I’ll remember that your telescope is a Celestron NexStar 8SE."'].join("\n"),
    ["SWX/1", "@edge fact_scope addresses user_input_2", '@final "Your telescope is a Celestron NexStar 8SE."'].join("\n")
  ];
  const model: Model = {
    async complete(input: ModelInput) { prompts.push(input.prompt); return { text: outputs[prompts.length - 1] ?? outputs[1] }; },
    async *stream(): AsyncIterable<ModelToken> { /* primitive uses complete */ }
  };

  const memory = new GraphMemoryAgent({ model });
  const stored = await memory.run("Remember that my telescope is a Celestron NexStar 8SE.");
  const recalled = await memory.run("Which telescope model did I mention?");
  const frame = memory.getFrame();

  expect(prompts).toHaveLength(2);
  expect(stored.transactionValid).toBe(true);
  expect(recalled.transactionValid).toBe(true);
  expect(recalled.answer).toBe("Your telescope is a Celestron NexStar 8SE.");
  expect(prompts[1]).toContain("fact_scope");
  expect(frame.graph.nodes.some((node) => node.id === "fact_scope" && node.type === "fact")).toBe(true);
  expect(frame.graph.edges.length).toBeGreaterThanOrEqual(4);
});

it("does not silently commit an invalid one-call graph transaction", async () => {
  const model: Model = {
    async complete() { return { text: 'SWX/1\n@final "Unconnected input"' }; },
    async *stream(): AsyncIterable<ModelToken> { /* primitive uses complete */ }
  };
  const memory = new GraphMemoryAgent({ model });
  const result = await memory.run("Remember this fact.");

  expect(result.transactionValid).toBe(false);
  expect(result.answer).toContain("invalid StateWeave transaction");
  expect(memory.getFrame().graph.nodes.some((node) => node.type === "assistant_output")).toBe(false);
});
