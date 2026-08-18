import { expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import { estimateStateWeaveTokens } from "../src/llm/tokenizer.js";
import type { Tool } from "../src/tools/types.js";
import { z } from "zod";

class StreamOnlyModel implements Model {
  calls = 0;

  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new Error("Agent.streamEvents must use Model.stream().");
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    this.calls += 1;
    yield { type: "metadata", metadata: { inputTokens: 19 } };
    yield { type: "token", token: "FINAL: " };
    yield { type: "token", token: "streamed answer" };
    yield { type: "metadata", metadata: { outputTokens: 3 } };
  }
}

class AnthropicCachedStreamModel implements Model {
  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new Error("The cache usage probe must use Model.stream().");
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "metadata", metadata: { provider: "anthropic", event: "message_start", usage: { input_tokens: 0, output_tokens: 0 } } };
    yield { type: "token", token: "FINAL: cached answer" };
    yield { type: "metadata", metadata: { provider: "anthropic", event: "message_delta", usage: { input_tokens: 17, output_tokens: 3, cache_read_input_tokens: 11, cache_creation_input_tokens: 5 } } };
  }
}

class IncompleteUsageStreamModel implements Model {
  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new Error("The incomplete usage probe must use Model.stream().");
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "metadata", metadata: { provider: "anthropic", event: "message_start", usage: { input_tokens: 0, output_tokens: 0 } } };
    yield { type: "token", token: "FINAL: incomplete usage answer" };
    yield { type: "metadata", metadata: { provider: "anthropic", event: "message_delta", usage: { output_tokens: 3 } } };
  }
}

class SequenceModel implements Model {
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async complete(_input: ModelInput): Promise<ModelOutput> {
    return { text: this.outputs[this.index++] ?? "FINAL: Done." };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: (await this.complete(input)).text };
  }
}

const longContextQuery = "Recall the critical legacy fact about the launch window.";
const longContextFact = "CRITICAL LEGACY FACT: the launch window is Thursday at 09:17 UTC.";

class AbortProbeModel implements Model {
  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new Error("The abort probe must use Model.stream().");
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: "FINAL: partial" };
    await new Promise<never>((_resolve, reject) => {
      const abort = (): void => reject(input.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

class LongContextRecallModel implements Model {
  sawFact = false;

  async complete(input: ModelInput): Promise<ModelOutput> {
    this.sawFact = input.prompt.includes(longContextFact);
    return { text: this.sawFact ? "FINAL: The critical legacy fact is Thursday at 09:17 UTC." : "FINAL: I could not find the critical legacy fact." };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: (await this.complete(input)).text };
  }
}

function buildLongContextState() {
  const weave = new CausalWeave();
  const system = weave.append({ kind: "system", payload: "Use the causal state and answer accurately.", parents: [], advance: false });
  weave.append({ kind: "semantic", resourceKey: "semantic:memory:legacy-fact", parents: [system.id], advance: false, payload: { type: "memory", key: "legacy-fact", content: longContextFact } });
  for (let index = 0; index < 100; index += 1) {
    weave.append({
      kind: "semantic",
      resourceKey: `semantic:memory:noise-${index}`,
      parents: [system.id],
      advance: false,
      payload: { type: "memory", key: `noise-${index}`, content: `Noise evidence ${index}: ${"context that should be projected only when relevant ".repeat(72)}` }
    });
  }
  return weave.snapshot();
}

it("forwards provider tokens and metadata through streamEvents", async () => {
  const model = new StreamOnlyModel();
  const agent = new Agent({ model, tools: [], enforceCompletionEvidence: false });
  const events = [];

  for await (const event of agent.streamEvents("Answer once")) events.push(event);

  expect(model.calls).toBe(1);
  expect(events.filter((event) => event.type === "model_token")).toEqual([
    { type: "model_token", iteration: 1, token: "FINAL: " },
    { type: "model_token", iteration: 1, token: "streamed answer" }
  ]);
  expect(events).toContainEqual({ type: "model_metadata", iteration: 1, metadata: { inputTokens: 19 } });
  expect(events).toContainEqual({ type: "model_metadata", iteration: 1, metadata: { outputTokens: 3 } });
  const final = events.find((event) => event.type === "final");
  expect(final?.type).toBe("final");
  if (final?.type === "final") {
    expect(final.result.finalAnswer).toBe("streamed answer");
    expect(final.result.metadata.totalInputTokens).toBe(19);
    expect(final.result.metadata.peakContextTokens).toBe(19);
    expect(final.result.metadata.outputTokens).toBe(3);
    expect(final.result.metadata.tokenCountSource).toBe("provider");
  }
});

it("counts cached Anthropic input toward the context window", async () => {
  const agent = new Agent({ model: new AnthropicCachedStreamModel(), tools: [], enforceCompletionEvidence: false });
  const events = [];

  for await (const event of agent.streamEvents("Answer from cached context")) events.push(event);

  const final = events.find((event) => event.type === "final");
  expect(final?.type).toBe("final");
  if (final?.type === "final") {
    expect(final.result.metadata.latestContextTokens).toBe(33);
    expect(final.result.metadata.peakContextTokens).toBe(33);
    expect(final.result.metadata.totalInputTokens).toBe(33);
    expect(final.result.metadata.outputTokens).toBe(3);
    expect(final.result.metadata.tokenCountSource).toBe("provider");
  }
});

it("labels incomplete provider usage as estimated instead of reporting zero input", async () => {
  const agent = new Agent({ model: new IncompleteUsageStreamModel(), tools: [], enforceCompletionEvidence: false });
  const events = [];

  for await (const event of agent.streamEvents("Answer with incomplete provider usage")) events.push(event);

  const final = events.find((event) => event.type === "final");
  expect(final?.type).toBe("final");
  if (final?.type === "final") {
    expect(final.result.metadata.latestContextTokens).toBeGreaterThan(0);
    expect(final.result.metadata.totalInputTokens).toBeGreaterThan(0);
    expect(final.result.metadata.tokenCountSource).toBe("estimated");
  }
});

it("labels tokenizer fallback counts as estimated", async () => {
  const agent = new Agent({ model: new SequenceModel(["FINAL: estimated answer"]), tools: [], enforceCompletionEvidence: false });
  const result = await agent.run("Answer without provider usage");

  expect(result.metadata.latestContextTokens).toBeGreaterThan(0);
  expect(result.metadata.peakContextTokens).toBe(result.metadata.latestContextTokens);
  expect(result.metadata.tokenCountSource).toBe("estimated");
});

it("records recognized successful checks as verification nodes", async () => {
  const tools: Tool[] = [
    {
      name: "write_file",
      description: "Write one file.",
      schema: z.object({ file_path: z.string(), content: z.string() }),
      execute: async (args) => ({ file_path: (args as { file_path: string }).file_path, content_hash: "written", ok: true })
    },
    {
      name: "read_file",
      description: "Read one file.",
      schema: z.object({ file_path: z.string() }),
      execute: async (args) => ({ file_path: (args as { file_path: string }).file_path, content_hash: "verified", content: "ready" })
    }
  ];
  const agent = new Agent({
    model: new SequenceModel([
      'TOOL_CALL {"name":"write_file","args":{"file_path":"config.txt","content":"ready"}}',
      'TOOL_CALL {"name":"read_file","args":{"file_path":"config.txt"}}',
      "FINAL: Wrote and verified config.txt."
    ]),
    tools,
    maxIterations: 3
  });

  const result = await agent.run("Write config.txt and verify it");
  expect(result.state.nodes).toContainEqual(expect.objectContaining({
    kind: "verification",
    payload: { method: "post_mutation_read", path: "config.txt" }
  }));
});

it("resets the completion retry streak after each accepted tool action", async () => {
  const tools: Tool[] = [
    {
      name: "read_file",
      description: "Read one file.",
      schema: z.object({ file_path: z.string() }),
      execute: async () => ({ path: "source.txt", content_hash: "source", content: "observed" })
    },
    {
      name: "write_file",
      description: "Write one file.",
      schema: z.object({ file_path: z.string(), content: z.string() }),
      execute: async () => ({ path: "output.txt", content_hash: "output", ok: true })
    },
    {
      name: "bash_command",
      description: "Run a fixed syntax check.",
      schema: z.object({ command: z.string() }),
      execute: async () => ({ exitCode: 0, stdout: "", stderr: "" })
    }
  ];
  const agent = new Agent({
    model: new SequenceModel([
      "FINAL: I have started the work.",
      'TOOL_CALL {"name":"read_file","args":{"file_path":"source.txt"}}',
      "FINAL: I have inspected the source.",
      'TOOL_CALL {"name":"write_file","args":{"file_path":"output.txt","content":"ready"}}',
      "FINAL: The file is written.",
      'TOOL_CALL {"name":"bash_command","args":{"command":"node --check output.js"}}',
      "FINAL: Inspected the source, wrote output.txt, and completed the syntax check."
    ]),
    tools,
    maxIterations: 7
  });

  const result = await agent.run("Inspect source.txt, write output.txt, and run a syntax check.");

  expect(result.finalAnswer).toContain("completed the syntax check");
  expect(result.trace.filter((step) => step.action === "invalid")).toHaveLength(3);
  expect(result.trace.at(-1)?.action).toBe("final");
});

it("stops after three consecutive retry iterations even when their outputs differ", async () => {
  const agent = new Agent({
    model: new SequenceModel([
      "I will inspect the workspace first.",
      "I am still preparing the inspection.",
      "I need one more moment to inspect it."
    ]),
    tools: [],
    maxIterations: 20,
    enforceCompletionEvidence: false
  });

  await expect(agent.run("Inspect the workspace.")).rejects.toThrow(/stopped after 3 consecutive retries/i);
});

it("keeps compiled prompts at or below the configured token estimate ceiling", () => {
  const weave = new CausalWeave();
  const system = weave.append({ kind: "system", payload: "Use the causal state.", parents: [], advance: false });
  weave.append({ kind: "goal", payload: "Answer the current question.", parents: [system.id] });

  const compiled = weave.compile({ maxTokens: 1_024, targetTokens: 512 });

  expect(compiled.tokenEstimate.estimatedTokens).toBeLessThanOrEqual(1_024);
  expect(compiled.prompt).toContain("<BIG_BRAIN>");
  expect(compiled.prompt).toContain("<FOCUS>");
});

it("keeps an exact old memory through long-context projection, abort, and state import", async () => {
  const initialState = buildLongContextState();
  const serializedTokens = estimateStateWeaveTokens(JSON.stringify(initialState)).estimatedTokens;
  const compiled = new CausalWeave(initialState).compile({ query: longContextQuery, maxTokens: 64_000, targetTokens: 16_000 });
  expect(serializedTokens).toBeGreaterThan(64_000);
  expect(compiled.tokenEstimate.estimatedTokens).toBeLessThanOrEqual(64_000);
  expect(compiled.prompt).toContain(longContextFact);

  const abortAgent = new Agent({ model: new AbortProbeModel(), state: initialState, tools: [], maxPromptTokens: 64_000, projectionTargetTokens: 16_000, enforceCompletionEvidence: false });
  const beforeAbort = JSON.stringify(abortAgent.getState());
  const controller = new AbortController();
  for await (const event of abortAgent.streamEvents(longContextQuery, { signal: controller.signal })) {
    if (event.type === "model_token") {
      controller.abort(new DOMException("Test abort", "AbortError"));
      break;
    }
  }
  expect(JSON.stringify(abortAgent.getState())).toBe(beforeAbort);

  const recallModel = new LongContextRecallModel();
  const resumedAgent = new Agent({ model: recallModel, state: abortAgent.getState(), tools: [], maxPromptTokens: 64_000, projectionTargetTokens: 16_000, enforceCompletionEvidence: false });
  const resumed = await resumedAgent.run(longContextQuery);
  expect(recallModel.sawFact).toBe(true);
  expect(resumed.finalAnswer).toBe("The critical legacy fact is Thursday at 09:17 UTC.");

  const importedModel = new LongContextRecallModel();
  const importedAgent = new Agent({ model: importedModel, state: resumed.state, tools: [], maxPromptTokens: 64_000, projectionTargetTokens: 16_000, enforceCompletionEvidence: false });
  const imported = await importedAgent.run(longContextQuery);
  expect(importedModel.sawFact).toBe(true);
  expect(imported.finalAnswer).toBe("The critical legacy fact is Thursday at 09:17 UTC.");
});
