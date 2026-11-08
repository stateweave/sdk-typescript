import { expect, it, vi } from "vitest";
import { AnthropicModel, anthropicConfigFromEnv, normalizeAnthropicUsage } from "../src/llm/anthropicModel.js";

it("normalizes provider input, output, and cache token evidence", () => {
  expect(normalizeAnthropicUsage({
    input_tokens: 17,
    output_tokens: 2,
    cache_read_input_tokens: 11,
    cache_creation_input_tokens: 5
  })).toEqual({
    inputTokens: 33,
    outputTokens: 2,
    totalTokens: 35,
    uncachedInputTokens: 17,
    cacheReadInputTokens: 11,
    cacheCreationInputTokens: 5
  });
});

it("does not invent provider usage when required counters are absent", () => {
  expect(normalizeAnthropicUsage(undefined)).toBeUndefined();
  expect(normalizeAnthropicUsage({ input_tokens: 17 })).toBeUndefined();
});

it("retains request defaults when environment and per-call options are undefined", async () => {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ content: [{ type: "text", text: "fixture" }] }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const model = new AnthropicModel(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "not-a-real-key" }));
  await model.complete({ prompt: "Inspect", parameters: { model: undefined, maxTokens: undefined, temperature: undefined } });
  const payload = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(payload).toMatchObject({ model: expect.any(String), max_tokens: 8192, temperature: 0, stream: false });
  expect(payload.system).toBe("You are a precise, helpful assistant. Follow the requested response format.");
  expect(payload.messages).toEqual([{ role: "user", content: "Inspect" }]);
  expect(fetch).toHaveBeenCalledOnce();
});

it("preserves explicit zeroes and per-call model overrides", async () => {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ content: [{ type: "text", text: "fixture" }] })));
  vi.stubGlobal("fetch", fetch);
  const model = new AnthropicModel({ apiKey: "not-a-real-key", model: "fixture-default", maxTokens: 123, temperature: 0.7 });
  await model.complete({ prompt: "Inspect", system: "Explicit task instructions", parameters: { model: "fixture-override", maxTokens: 456, temperature: 0, topP: 0 } });
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({ model: "fixture-override", max_tokens: 456, temperature: 0, top_p: 0, system: "Explicit task instructions" });
});

it("bounds model calls by default while allowing an environment override", () => {
  expect(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "test" }).timeoutMs).toBe(180_000);
  expect(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "test", ANTHROPIC_TIMEOUT_MS: "45000" }).timeoutMs).toBe(45_000);
});
