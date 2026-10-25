import { describe, expect, it } from "vitest";
import { CodexModelError, normalizeCodexUsage, parseCodexStream } from "../src/llm/codexModel.js";
import { addUsage, callCost, emptyTotals, halcyonScript, MeteredModel, scoreCheck } from "../src/web/codexCostBench.js";
import { chooseModel, modelChoices } from "../src/web/codexAccount.js";
import type { Model, ModelToken } from "../src/llm/model.js";

const encoder = new TextEncoder();
async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield encoder.encode(part);
}
async function collect(stream: AsyncIterable<ModelToken>): Promise<ModelToken[]> {
  const out: ModelToken[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const completed = (usage: unknown) => `data: ${JSON.stringify({ type: "response.completed", response: { usage } })}\n`;

describe("Codex SSE parsing", () => {
  it("streams text deltas split across chunks and reports usage", async () => {
    const delta = (text: string) => `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n`;
    const body = delta("Hel") + delta("lo") + completed({ input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } });
    const events = await collect(parseCodexStream(chunks(body.slice(0, 17), body.slice(17, 90), body.slice(90)), "gpt-5.5"));
    expect(events.filter((e) => e.type === "token").map((e) => (e as { token: string }).token).join("")).toBe("Hello");
    const meta = events.find((e) => e.type === "metadata") as { metadata: { usage: unknown } };
    expect(meta.metadata.usage).toEqual({ inputTokens: 1000, uncachedInputTokens: 600, cacheReadInputTokens: 400, cacheCreationInputTokens: 0, outputTokens: 300, totalTokens: 1300, reasoningTokens: 200 });
  });

  it("rejects interrupted and failed streams", async () => {
    await expect(collect(parseCodexStream(chunks(`data: {"type":"response.output_text.delta","delta":"x"}\n`), "m"))).rejects.toBeInstanceOf(CodexModelError);
    await expect(collect(parseCodexStream(chunks(`data: {"type":"response.failed"}\n`), "m"))).rejects.toBeInstanceOf(CodexModelError);
  });

  it("ignores usage without token counts", () => {
    expect(normalizeCodexUsage({})).toBeUndefined();
  });
});

describe("cost math", () => {
  const pricing = { input: 5, cachedInput: 0.5, output: 30 };

  it("prices uncached, cached and output tokens separately", () => {
    const cost = callCost({ inputTokens: 100_000, uncachedInputTokens: 60_000, cacheReadInputTokens: 40_000, outputTokens: 10_000, totalTokens: 0 }, pricing);
    expect(cost).toBeCloseTo(0.3 + 0.02 + 0.3, 6);
  });

  it("applies the long-context surcharge above 272K input", () => {
    const cost = callCost({ inputTokens: 300_000, uncachedInputTokens: 300_000, cacheReadInputTokens: 0, outputTokens: 10_000, totalTokens: 0 }, pricing);
    expect(cost).toBeCloseTo(1.5 * 2 + 0.3 * 1.5, 6);
  });

  it("counts calls with no usage separately", () => {
    const totals = emptyTotals();
    addUsage(totals, undefined, pricing);
    addUsage(totals, { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 2 }, pricing);
    expect(totals).toMatchObject({ calls: 2, missingUsageCalls: 1, inputTokens: 10, outputTokens: 5, reasoningTokens: 2, peakInputTokens: 10 });
  });

  it("meters streamed calls through the wrapper", async () => {
    const inner: Model = {
      complete: async () => ({ text: "x", usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } }),
      async *stream() {
        yield { type: "token", token: "x" };
        yield { type: "metadata", metadata: { usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220 } } };
      }
    };
    const metered = new MeteredModel(inner, pricing);
    await metered.complete({ prompt: "a" });
    await collect(metered.stream({ prompt: "b" }));
    expect(metered.bucket).toMatchObject({ calls: 2, inputTokens: 300, outputTokens: 30 });
  });
});

describe("recall scoring and model selection", () => {
  it("fails a check that repeats a superseded fact", () => {
    const check = halcyonScript[4]!;
    expect(scoreCheck("Budget NOK 3.8 million, launch 2 May 2027, lead engineer Mateo Ruiz.", check).passed).toBe(true);
    expect(scoreCheck("Budget NOK 4.2 million, launch 2 May 2027, Mateo.", check)).toMatchObject({ passed: false, missing: ["3.8"], forbidden: ["4.2"] });
  });

  it("only accepts advertised model and thinking combinations", () => {
    const choices = modelChoices([{ model: "gpt-5.5", displayName: "GPT-5.5", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] }, { model: "old", hidden: true }]);
    expect(choices.map((c) => c.id)).toEqual(["gpt-5.5"]);
    expect(chooseModel(choices, { model: "gpt-5.5", thinking: "high" })).toEqual({ model: "gpt-5.5", reasoningEffort: "high" });
    expect(() => chooseModel(choices, { model: "gpt-5.5", thinking: "xhigh" })).toThrow();
    expect(() => chooseModel(choices, { model: "old", thinking: "" })).toThrow();
  });
});
