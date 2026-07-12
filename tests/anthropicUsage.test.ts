import { expect, it } from "vitest";
import { anthropicConfigFromEnv, normalizeAnthropicUsage } from "../src/llm/anthropicModel.js";

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

it("bounds model calls by default while allowing an environment override", () => {
  expect(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "test" }).timeoutMs).toBe(180_000);
  expect(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "test", ANTHROPIC_TIMEOUT_MS: "45000" }).timeoutMs).toBe(45_000);
});
