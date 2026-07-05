import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runStateWeave } from "../src/agent/stateweaveRunner.js";
import { applyOps } from "../src/core/applyOps.js";
import { createInitialGraphFrame } from "../src/core/graph.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";
import { createFileSystemTools } from "../src/tools/fileSystemTools.js";

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
  expect(result.metadata.tools).toEqual([]);
  expect(result.trace).toHaveLength(2);
  expect(result.trace[0].durationMs).toBeGreaterThanOrEqual(0);
  expect(result.trace[0].error).toMatch(/pending latest user input user_input_2 is disconnected/);
  expect(result.trace[1].frameBefore.frame.lastGraphOpsError).toMatch(/GraphOps rejected/);
  expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "user_input_2", type: "follows" }));
  expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "assistant_output_2", to: "house_svg", type: "creates" }));
});

it("runs workspace write/edit tools end to end with SWX block-ref args", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-runner-tools-"));
  try {
    const model = new SequenceModel([
      [
        "SWX/1",
        "@edge system_root follows user_input_1",
        "@tool write_file file_path=created_with_tool.svg content_ref=svg_1",
        "<<<svg_1:image/svg+xml",
        "<svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\" /></svg>",
        ">>>"
      ].join("\n"),
      [
        "SWX/1",
        "@tool edit_file file_path=created_with_tool.svg old_string_ref=old_1 new_string_ref=new_1",
        "<<<old_1:text/plain",
        "<rect width=\"10\" height=\"10\" />",
        ">>>",
        "<<<new_1:text/plain",
        "<circle cx=\"5\" cy=\"5\" r=\"4\" />",
        ">>>"
      ].join("\n"),
      "SWX/1\n@final \"Created and edited the SVG file.\""
    ]);

    const result = await runStateWeave({ model, tools: createFileSystemTools({ rootDir: root }), maxSteps: 3 }, "Create and refine an SVG file");
    const content = await readFile(path.join(root, "created_with_tool.svg"), "utf8");

    expect(content).toBe("<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>");
    expect(result.finalAnswer).toBe("Created and edited the SVG file.");
    expect(result.trace.flatMap((step) => step.parsedOps)).not.toContainEqual(expect.objectContaining({ op: "add_node", node: expect.objectContaining({ id: "svg_1" }) }));
    expect(result.graph.nodes.filter((node) => node.type === "tool_result")).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
