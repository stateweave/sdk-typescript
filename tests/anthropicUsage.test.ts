import { expect, it } from "vitest";
import { normalizeAnthropicUsage } from "../src/llm/anthropicModel.js";

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
