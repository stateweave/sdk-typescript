import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { Agent } from "../src/agent/stateweaveAgent.js";
import { runStateWeave, StateWeaveRunError } from "../src/agent/stateweaveRunner.js";
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
  expect(result.frame.graph).toEqual(result.graph);
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

it("throws a clear recursion-limit error when maxIterations is exhausted", async () => {
  const output = "SWX/1\n@edge system_root follows user_input_1\n@node note_1 note \"Still working\"\n@edge user_input_1 creates note_1";

  await expect(runStateWeave({ model: new SequenceModel([output]), tools: [], maxSteps: 1 }, "Keep going forever")).rejects.toThrow(StateWeaveRunError);
  await expect(runStateWeave({ model: new SequenceModel([output]), tools: [], maxSteps: 1 }, "Keep going forever")).rejects.toThrow(/Recursion limit reached.*maxIterations/);
});

it("Agent streams final text by default and keeps one graph across user turns", async () => {
  const agent = new Agent({
    model: new SequenceModel([
      "SWX/1\n@edge system_root follows user_input_1\n@node intent_1 intent \"Build todo app\"\n@edge user_input_1 creates intent_1\n@final \"Started todo app.\"",
      "SWX/1\n@edge intent_1 follows user_input_2\n@node constraint_1 constraint \"Add keyboard shortcuts\"\n@edge user_input_2 constrains constraint_1\n@final \"Added shortcut requirement.\""
    ]),
    nodeTypes: ["intent", "constraint", "artifact"],
    maxIterations: 2,
    tools: []
  });

  const firstChunks: string[] = [];
  for await (const chunk of agent.stream("Build a todo app")) firstChunks.push(chunk);
  const second = await agent.run("Add keyboard shortcuts.");

  expect(firstChunks.join("")).toBe("Started todo app.");
  expect(second.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_1", text: "Build a todo app" }));
  expect(second.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_2", text: "Add keyboard shortcuts." }));
  expect(second.trace[0].prompt).toContain("semanticNodeTypes:\n- intent\n- constraint\n- artifact");
  expect(agent.getFrame()?.graph.nodes).toHaveLength(second.graph.nodes.length);
});

it("Agent runs same-graph turns concurrently and merges branch results", async () => {
  const agent = new Agent({ model: new ConcurrentModel(), tools: [], maxIterations: 2 });

  const [slow, fast] = await Promise.all([agent.run("slow branch"), agent.run("fast branch")]);
  const frame = agent.getFrame();

  expect(slow.finalAnswer).toBe("slow done");
  expect(fast.finalAnswer).toBe("fast done");
  expect(frame?.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_1", text: "slow branch" }));
  expect(frame?.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_2", text: "fast branch" }));
  expect(frame?.graph.nodes.filter((node) => node.type === "assistant_output")).toHaveLength(2);
  expect(new Set(frame?.graph.nodes.filter((node) => node.type === "assistant_output").map((node) => node.id)).size).toBe(2);
});

class ConcurrentModel implements Model {
  async complete(input: ModelInput): Promise<ModelOutput> {
    return { text: await this.output(input) };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: await this.output(input) };
  }

  private async output(input: ModelInput): Promise<string> {
    const latest = input.frame?.frame.latestInputNodeId ?? "user_input_1";
    const slow = input.frame?.graph.nodes.find((node) => node.id === latest)?.text.includes("slow") ?? false;
    if (slow) await new Promise((resolve) => setTimeout(resolve, 25));
    const label = slow ? "slow" : "fast";
    return `SWX/1\n@edge system_root follows ${latest}\n@node ${label}_branch branch_work \"${label} branch\"\n@edge ${latest} creates ${label}_branch\n@final \"${label} done\"`;
  }
}

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
