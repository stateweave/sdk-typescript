import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { AgenticBaseline, type AgenticMessage, type AgenticProgress } from "../src/evals/agenticBaseline.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";
import { createFileSystemTools } from "../src/tools/fileSystemTools.js";
import type { Tool } from "../src/tools/types.js";

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

class PlanningThenToolModel implements Model {
  private outputs = [
    "I'll start by reading the requested file.",
    'TOOL_CALL {"name":"read_file","args":{"file_path":"source.txt"}}',
    "FINAL: Read and verified source.txt."
  ];

  async complete(): Promise<ModelOutput> { return { text: this.outputs.shift() ?? "FINAL: done" }; }
  async *stream(): AsyncIterable<ModelToken> { yield { type: "token", token: "FINAL: done" }; }
}

class FabricatingToolTranscriptModel implements Model {
  private outputs = [
    'TOOL_CALL {"name":"read_file","args":{"file_path":"source.txt"}}\nTOOL: {"content":"fabricated"}\nASSISTANT: FINAL: done',
    'TOOL_CALL {"name":"write_file","args":{"file_path":"real.txt","content":"real"}}',
    "FINAL: Created real.txt."
  ];

  async complete(): Promise<ModelOutput> { return { text: this.outputs.shift() ?? "FINAL: done" }; }
  async *stream(): AsyncIterable<ModelToken> { yield { type: "token", token: "FINAL: done" }; }
}

class MissingQuoteToolModel implements Model {
  private outputs = [
    'TOOL_CALL {"name":"write_file","args":{"file_path":"repaired.txt","content":"ready}}',
    "FINAL: Created repaired.txt."
  ];

  async complete(): Promise<ModelOutput> { return { text: this.outputs.shift() ?? "FINAL: done" }; }
  async *stream(): AsyncIterable<ModelToken> { yield { type: "token", token: "FINAL: done" }; }
}

class UnescapedCommandQuoteModel implements Model {
  private outputs = [
    'TOOL_CALL {"name":"bash_command","args":{"command":"find test -type f -name "*.js" | sort}}',
    "FINAL: Inspected JavaScript tests."
  ];

  async complete(): Promise<ModelOutput> { return { text: this.outputs.shift() ?? "FINAL: done" }; }
  async *stream(): AsyncIterable<ModelToken> { yield { type: "token", token: "FINAL: done" }; }
}

class RepeatingInvalidModel implements Model {
  calls = 0;

  async complete(): Promise<ModelOutput> {
    this.calls += 1;
    return { text: "I will inspect the workspace first." };
  }

  async *stream(): AsyncIterable<ModelToken> { yield { type: "token", token: "FINAL: done" }; }
}

class BlockingModel implements Model {
  async complete(input: ModelInput): Promise<ModelOutput> {
    if (!input.signal) throw new Error("missing abort signal");
    if (input.signal.aborted) throw input.signal.reason;
    await new Promise((_, reject) => input.signal!.addEventListener("abort", () => reject(input.signal!.reason), { once: true }));
    return { text: "FINAL: unreachable" };
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: "FINAL: unreachable" };
  }
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
    const progress: AgenticProgress[] = [];
    const result = await agent.run("Create the result file.", { onProgress: (update) => progress.push(update) });
    expect(result.answer).toBe("Created notes/result.txt.");
    expect(result.modelCalls).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(progress.map((update) => update.phase)).toEqual(expect.arrayContaining(["context", "model", "tool", "final"]));
    expect(progress.at(-1)).toEqual(expect.objectContaining({ phase: "final", modelCalls: 2, toolCalls: 1 }));
    expect(await readFile(path.join(root, "notes/result.txt"), "utf8")).toBe("done");
    expect(agent.getMessages().map((message) => message.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects planning prose as premature completion and continues to tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-agentic-planning-"));
  try {
    await writeFile(path.join(root, "source.txt"), "real source");
    const agent = new AgenticBaseline({ model: new PlanningThenToolModel(), tools: createFileSystemTools({ rootDir: root }), systemPrompt: "Maintain the workspace." });
    const result = await agent.run("Read and verify source.txt.");

    expect(result.answer).toBe("Read and verified source.txt.");
    expect(result.modelCalls).toBe(3);
    expect(result.toolCalls).toBe(1);
    expect(agent.getMessages()).toContainEqual(expect.objectContaining({ role: "tool", content: expect.stringContaining("Planning prose is not a final answer") }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("executes only the leading tool call and discards fabricated transcript continuations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-agentic-strict-"));
  try {
    await writeFile(path.join(root, "source.txt"), "real source");
    const agent = new AgenticBaseline({ model: new FabricatingToolTranscriptModel(), tools: createFileSystemTools({ rootDir: root }), systemPrompt: "Maintain the workspace." });
    const result = await agent.run("Create the real file.");
    expect(result.answer).toBe("Created real.txt.");
    expect(result.modelCalls).toBe(3);
    expect(result.toolCalls).toBe(2);
    expect(await readFile(path.join(root, "real.txt"), "utf8")).toBe("real");
    expect(agent.getMessages().some((message) => message.content.includes("fabricated"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("repairs an unambiguous missing quote at the end of a tool envelope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-agentic-repair-"));
  try {
    const agent = new AgenticBaseline({ model: new MissingQuoteToolModel(), tools: createFileSystemTools({ rootDir: root }), systemPrompt: "Maintain the workspace." });
    const result = await agent.run("Create repaired.txt.");

    expect(result.answer).toBe("Created repaired.txt.");
    expect(result.toolCalls).toBe(1);
    expect(await readFile(path.join(root, "repaired.txt"), "utf8")).toBe("ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("repairs unescaped quotes inside a shell command argument", async () => {
  const commands: string[] = [];
  const bashTool: Tool = {
    name: "bash_command",
    description: "Record a read-only command.",
    schema: z.object({ command: z.string() }),
    execute: async (args: unknown) => {
      const { command } = z.object({ command: z.string() }).parse(args);
      commands.push(command);
      return { exitCode: 0, output: "test/example.js" };
    }
  };
  const agent = new AgenticBaseline({ model: new UnescapedCommandQuoteModel(), tools: [bashTool], systemPrompt: "Maintain the workspace." });

  const result = await agent.run("Inspect JavaScript tests.");

  expect(result.answer).toBe("Inspected JavaScript tests.");
  expect(commands).toEqual(['find test -type f -name "*.js" | sort']);
  expect(agent.getMessages().some((message) => message.content.startsWith("protocol_error:"))).toBe(false);
});

it("fails a repeated invalid envelope quickly instead of exhausting the full iteration budget", async () => {
  const model = new RepeatingInvalidModel();
  const agent = new AgenticBaseline({ model, tools: [], maxIterations: 300, systemPrompt: "Maintain the workspace." });

  await expect(agent.run("Inspect the workspace.")).rejects.toThrow(/repeated the same invalid.*3 times/i);
  expect(model.calls).toBe(3);
});

it("cancels an active native model call", async () => {
  const controller = new AbortController();
  const agent = new AgenticBaseline({ model: new BlockingModel(), tools: [], systemPrompt: "Maintain the workspace." });
  const run = agent.run("Wait forever", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new DOMException("stopped", "AbortError"));

  await expect(run).rejects.toMatchObject({ name: "AbortError" });
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
