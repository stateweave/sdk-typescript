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
    expect(final.result.metadata.outputTokens).toBe(3);
  }
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
