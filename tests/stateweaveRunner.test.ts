import { expect, it } from "vitest";
import { runStateWeave } from "../src/agent/stateweaveRunner.js";
import { applyOps } from "../src/core/applyOps.js";
import { createInitialGraphFrame } from "../src/core/graph.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";

it("retries rejected GraphOps and commits the corrected transaction", async () => {
  const firstFrame = applyOps(
    createInitialGraphFrame({ objective: "Draw SVG", input: "Create a butterfly", availableActions: [] }),
    [{ op: "final", answer: "Butterfly done." }]
  );
  const model = new SequenceModel([
    [
      "SWX/1",
      "@node house_svg svg_artifact \"House SVG\" mime=image/svg+xml",
      "@final house_svg",
      "<<<house_svg:image/svg+xml",
      "<svg><rect width=\"10\" height=\"10\" /></svg>",
      ">>>"
    ].join("\n"),
    [
      "SWX/1",
      "@edge system_root follows user_input_2",
      "@node house_svg svg_artifact \"House SVG\" mime=image/svg+xml",
      "@final house_svg",
      "<<<house_svg:image/svg+xml",
      "<svg><rect width=\"10\" height=\"10\" /></svg>",
      ">>>"
    ].join("\n")
  ]);

  const result = await runStateWeave({ model, tools: [], maxSteps: 2 }, "Create a house", { frame: firstFrame });

  expect(result.metadata.retryCount).toBe(1);
  expect(result.metadata.status).toBe("done");
  expect(result.trace).toHaveLength(2);
  expect(result.trace[0].durationMs).toBeGreaterThanOrEqual(0);
  expect(result.trace[0].error).toMatch(/pending latest user input user_input_2 is disconnected/);
  expect(result.trace[1].frameBefore.frame.lastGraphOpsError).toMatch(/GraphOps rejected/);
  expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "user_input_2", type: "follows" }));
  expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "assistant_output_2", to: "house_svg", type: "creates" }));
});

class SequenceModel implements Model {
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async complete(_input: ModelInput): Promise<ModelOutput> {
    return { text: this.next() };
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: this.next() };
  }

  private next(): string {
    return this.outputs[Math.min(this.index++, this.outputs.length - 1)] ?? "SWX/1\n@final \"done\"";
  }
}
