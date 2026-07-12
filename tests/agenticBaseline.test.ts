import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgenticBaseline, type AgenticMessage } from "../src/evals/agenticBaseline.js";
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

class FabricatingToolTranscriptModel implements Model {
  private outputs = [
    'TOOL_CALL {"name":"write_file","args":{"file_path":"fake.txt","content":"fake"}}\nTOOL: {"ok":true}\nFINAL: done',
    'TOOL_CALL {"name":"write_file","args":{"file_path":"real.txt","content":"real"}}',
    "FINAL: Created real.txt."
  ];

  async complete(): Promise<ModelOutput> { return { text: this.outputs.shift() ?? "FINAL: done" }; }
  async *stream(): AsyncIterable<ModelToken> { yield { type: "token", token: "FINAL: done" }; }
}

class CompactionModel implements Model {
  readonly prompts: string[] = [];

  async complete(input: ModelInput): Promise<ModelOutput> {
    this.prompts.push(input.prompt);
    return { text: this.prompts.length === 1 ? "Durable summary of older work." : "FINAL: Continued after compaction." };
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

it("rejects fabricated tool results and executes only a strict tool envelope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-agentic-strict-"));
  try {
    const agent = new AgenticBaseline({ model: new FabricatingToolTranscriptModel(), tools: createFileSystemTools({ rootDir: root }), systemPrompt: "Maintain the workspace." });
    const result = await agent.run("Create the real file.");
    expect(result.answer).toBe("Created real.txt.");
    expect(result.modelCalls).toBe(3);
    expect(result.toolCalls).toBe(1);
    expect(await readFile(path.join(root, "real.txt"), "utf8")).toBe("real");
    await expect(readFile(path.join(root, "fake.txt"), "utf8")).rejects.toThrow();
    expect(agent.getMessages().some((message) => message.content.includes("protocol_error"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("summarizes older messages at the threshold and preserves the latest six", async () => {
  const model = new CompactionModel();
  const messages: AgenticMessage[] = [
    { role: "system", content: "System protocol" },
    ...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `old-${index}-${"x".repeat(80)}` }))
  ];
  const agent = new AgenticBaseline({
    model,
    tools: [],
    systemPrompt: "Maintain the workspace.",
    messages,
    compaction: { thresholdTokens: 20, retainMessages: 6 }
  });

  const result = await agent.run("new-task");
  const compacted = agent.getMessages();
  expect(result.answer).toBe("Continued after compaction.");
  expect(result.compactions).toBe(1);
  expect(result.modelCalls).toBe(2);
  expect(compacted[1].content).toContain("COMPACTED TRANSCRIPT SUMMARY");
  expect(compacted.some((message) => message.content.startsWith("old-3-"))).toBe(true);
  expect(compacted.some((message) => message.content.startsWith("old-2-"))).toBe(false);
  expect(model.prompts[0]).toContain("old-0-");
  expect(model.prompts[0]).not.toContain("new-task");
});
