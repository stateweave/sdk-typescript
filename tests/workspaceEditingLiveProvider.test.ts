import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveBudget, ZaiGraphModel, ZaiMessagesModel, zaiConfigFromEnv, type ZaiLiveConfig } from "../eval/workspace-editing-v1/live-provider.js";

const config: ZaiLiveConfig = {
  apiKey: "test-secret",
  baseUrl: "https://api.z.ai/api/anthropic",
  model: "glm-5.3-flash",
  maxOutputTokens: 4096,
  timeoutMs: 180_000,
  maxProviderCalls: 3,
  maxReservedTokens: 20_000
};

afterEach(() => vi.unstubAllGlobals());

describe("workspace-editing live provider", () => {
  it("uses one strict full-history Z.ai request and records served identity and usage", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "glm-5.3-flash",
        max_tokens: 4096,
        temperature: 0,
        stream: false,
        system: "shared",
        messages: [
          { role: "user", content: "turn one" },
          { role: "assistant", content: "TOOL_CALL {...}" },
          { role: "user", content: "TOOL_RESULT {...}" },
          { role: "assistant", content: "FINAL_ANSWER: first done" },
          { role: "user", content: "turn two" }
        ]
      });
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-secret");
      expect(init?.redirect).toBe("error");
      return new Response(JSON.stringify({
        id: "msg_test",
        model: "glm-5.3-flash",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "FINAL_ANSWER: done" }],
        usage: { input_tokens: 120, output_tokens: 8 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const budget = new LiveBudget(config);
    const output = await new ZaiMessagesModel(config, budget).complete({
      system: "shared",
      messages: [
        { role: "user", content: "turn one" },
        { role: "assistant", content: "TOOL_CALL {...}" },
        { role: "user", content: "TOOL_RESULT {...}" },
        { role: "assistant", content: "FINAL_ANSWER: first done" },
        { role: "user", content: "turn two" }
      ]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output).toMatchObject({
      text: "FINAL_ANSWER: done",
      provider: "zai",
      model: "glm-5.3-flash",
      stopReason: "end_turn",
      usage: { inputTokens: 120, outputTokens: 8, totalTokens: 128 }
    });
    expect(budget.snapshot()).toMatchObject({ providerCalls: 1, knownInputTokens: 120, knownOutputTokens: 8, knownTotalTokens: 128 });
  });

  it("rejects a mismatched served Graph model before accepting response tokens", async () => {
    const stream = [
      'data: {"type":"message_start","message":{"id":"msg_bad","model":"glm-other","usage":{"input_tokens":10,"output_tokens":0}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SWX/1\\n@final \\"wrong\\""}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":8}}'
    ].join("\n\n") + "\n\n";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const model = new ZaiGraphModel(config, new LiveBudget(config));
    await expect(async () => {
      for await (const _event of model.stream({ prompt: "task", system: "shared" })) void _event;
    }).rejects.toThrow(/served model mismatch/);
  });

  it("fails before dispatch when a hard call or reserved-token ceiling would be exceeded", () => {
    const callBudget = new LiveBudget({ maxProviderCalls: 1, maxReservedTokens: 10_000 });
    callBudget.reserve(10, 10);
    expect(() => callBudget.reserve(10, 10)).toThrow(/provider-call ceiling/);

    const tokenBudget = new LiveBudget({ maxProviderCalls: 10, maxReservedTokens: 100 });
    expect(() => tokenBudget.reserve(80, 30)).toThrow(/reserved-token ceiling/);
  });

  it("accepts only the approved Z.ai endpoint and exact GLM model", () => {
    expect(zaiConfigFromEnv({
      ANTHROPIC_API_KEY: "present",
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.3-flash"
    })).toMatchObject({ model: "glm-5.3-flash", maxOutputTokens: 4096, maxProviderCalls: 240, maxReservedTokens: 5_000_000 });

    expect(() => zaiConfigFromEnv({
      ANTHROPIC_API_KEY: "present",
      ANTHROPIC_BASE_URL: "http://api.z.ai/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.3-flash"
    })).toThrow(/exact HTTPS/);
    expect(() => zaiConfigFromEnv({
      ANTHROPIC_API_KEY: "present",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_MODEL: "claude"
    })).toThrow(/api.z.ai/);
    expect(() => zaiConfigFromEnv({
      ANTHROPIC_API_KEY: "present",
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_MODEL: "glm-other"
    })).toThrow(/glm-5.3-flash/);
  });
});
