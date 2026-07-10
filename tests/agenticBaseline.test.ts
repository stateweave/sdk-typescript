import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgenticBaseline } from "../src/evals/agenticBaseline.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";
import { createFileSystemTools } from "../src/tools/fileSystemTools.js";

class SequenceModel implements Model {
  private outputs = [
    'TOOL_CALL {"name":"write_file","args":{"file_path":"notes/result.txt","content":"done"}}',
    "FINAL: Created notes/result.txt."
  ];

  async complete(_input: ModelInput): Promise<ModelOutput> {
    return { text: this.outputs.shift() ?? "FINAL: done" };
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: "FINAL: done" };
  }
}

it("runs a persistent messages agent through the same filesystem tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-agentic-"));
  try {
    const agent = new AgenticBaseline({ model: new SequenceModel(), tools: createFileSystemTools({ rootDir: root }), systemPrompt: "Maintain the workspace." });
    const result = await agent.run("Create the result file.");
    expect(result.answer).toBe("Created notes/result.txt.");
    expect(result.modelCalls).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(await readFile(path.join(root, "notes/result.txt"), "utf8")).toBe("done");
    expect(agent.getMessages().map((message) => message.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
