import type { Model, ModelInput, ModelOutput, ModelParameters, ModelToken, ModelUsage } from "./model.js";

export type AnthropicModelConfig = ModelParameters & {
  apiKey: string;
  baseUrl?: string;
  version?: string;
  beta?: string;
  system?: string;
  timeoutMs?: number;
  extra?: Record<string, unknown>;
};

type AnthropicContent = { type: "text"; text: string } | { type: string; [key: string]: unknown };

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type AnthropicResponse = {
  content?: AnthropicContent[];
  usage?: AnthropicUsage;
  error?: { message?: string; type?: string };
};

const defaultConfig = {
  baseUrl: "https://api.anthropic.com",
  version: "2023-06-01",
  model: "claude-3-5-sonnet-latest",
  maxTokens: 8192,
  temperature: 0
};

export class AnthropicModel implements Model {
  private config: Required<Pick<AnthropicModelConfig, "apiKey" | "baseUrl" | "version">> & AnthropicModelConfig;

  constructor(config: AnthropicModelConfig) {
    if (!config.apiKey) throw new Error("ANTHROPIC_API_KEY is required for AnthropicModel.");
    this.config = {
      ...defaultConfig,
      ...config,
      baseUrl: (config.baseUrl ?? defaultConfig.baseUrl).replace(/\/$/, ""),
      version: config.version ?? defaultConfig.version,
      apiKey: config.apiKey
    };
  }

  async complete(input: ModelInput): Promise<ModelOutput> {
    const response = await this.request(input, false);
    const json = (await response.json()) as AnthropicResponse;
    if (!response.ok) throw new Error(anthropicError(response.status, json));
    const usage = normalizeAnthropicUsage(json.usage);
    return { text: readText(json), ...(usage ? { usage } : {}) };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    const response = await this.request(input, true);
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as AnthropicResponse;
      throw new Error(anthropicError(response.status, json));
    }
    if (!response.body) throw new Error("Anthropic stream response had no body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = splitSseEvents(buffer);
      buffer = events.remainder;
      for (const event of events.items) {
        const parsed = parseSseEvent(event);
        if (parsed) yield parsed;
      }
    }

    buffer += decoder.decode();
    for (const event of splitSseEvents(`${buffer}\n\n`).items) {
      const parsed = parseSseEvent(event);
      if (parsed) yield parsed;
    }
  }

  private request(input: ModelInput, stream: boolean): Promise<Response> {
    return fetch(`${this.config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      signal: this.signal(input),
      body: JSON.stringify(this.payload(input, stream))
    });
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": this.config.version,
      ...(this.config.beta ? { "anthropic-beta": this.config.beta } : {})
    };
  }

  private payload(input: ModelInput, stream: boolean): Record<string, unknown> {
    const parameters = { ...this.config, ...input.parameters };
    return omitUndefined({
      ...this.config.extra,
      model: parameters.model,
      max_tokens: parameters.maxTokens,
      temperature: parameters.temperature,
      top_p: parameters.topP,
      top_k: parameters.topK,
      stop_sequences: parameters.stopSequences,
      stream,
      system: input.system ?? this.config.system ?? defaultSystem(),
      messages: [{ role: "user", content: input.prompt }]
    });
  }

  private signal(input: ModelInput): AbortSignal | undefined {
    if (!this.config.timeoutMs) return input.signal;
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  }
}

export function anthropicConfigFromEnv(env: NodeJS.ProcessEnv): AnthropicModelConfig {
  return {
    apiKey: env.ANTHROPIC_API_KEY ?? "",
    baseUrl: env.ANTHROPIC_BASE_URL,
    version: env.ANTHROPIC_VERSION,
    beta: env.ANTHROPIC_BETA,
    model: env.ANTHROPIC_MODEL,
    maxTokens: numberEnv(env.ANTHROPIC_MAX_TOKENS),
    temperature: numberEnv(env.ANTHROPIC_TEMPERATURE),
    topP: numberEnv(env.ANTHROPIC_TOP_P),
    topK: numberEnv(env.ANTHROPIC_TOP_K),
    stopSequences: listEnv(env.ANTHROPIC_STOP_SEQUENCES),
    system: env.ANTHROPIC_SYSTEM,
    timeoutMs: numberEnv(env.ANTHROPIC_TIMEOUT_MS),
    extra: jsonEnv(env.ANTHROPIC_EXTRA_JSON)
  };
}

function defaultSystem(): string {
  return [
    "You are a precise, helpful assistant evaluating two equivalent interaction formats: regular messages and StateWeave.",
    "Regular messages provide conversation text and expect a direct answer.",
    "StateWeave provides graph state and expects SWX/1 commands plus raw artifact blocks when useful.",
    "Treat both formats as equally capable; optimize for the user's requested outcome and artifact quality, not for the surrounding protocol.",
    "Follow the requested response format exactly for the format you receive."
  ].join(" ");
}

export function normalizeAnthropicUsage(usage: AnthropicUsage | undefined): ModelUsage | undefined {
  if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") return undefined;
  const uncachedInputTokens = usage.input_tokens;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = uncachedInputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  return {
    inputTokens,
    outputTokens: usage.output_tokens,
    totalTokens: inputTokens + usage.output_tokens,
    uncachedInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens
  };
}

function readText(response: AnthropicResponse): string {
  return response.content?.filter((item): item is { type: "text"; text: string } => item.type === "text").map((item) => item.text).join("") ?? "";
}

function anthropicError(status: number, response: AnthropicResponse): string {
  return `Anthropic request failed (${status}): ${response.error?.message ?? "unknown error"}`;
}

function parseSseEvent(event: string): ModelToken | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;

  const parsed = JSON.parse(data) as {
    type?: string;
    message?: { id?: string; model?: string; usage?: unknown };
    delta?: { type?: string; text?: string; stop_reason?: string; stop_sequence?: string | null };
    usage?: unknown;
  };
  if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) return { type: "token", token: parsed.delta.text };
  if (parsed.type === "message_start") return { type: "metadata", metadata: { provider: "anthropic", event: parsed.type, id: parsed.message?.id, model: parsed.message?.model, usage: parsed.message?.usage } };
  if (parsed.type === "message_delta") return { type: "metadata", metadata: { provider: "anthropic", event: parsed.type, stopReason: parsed.delta?.stop_reason, stopSequence: parsed.delta?.stop_sequence, usage: parsed.usage } };
  if (parsed.type === "message_stop") return { type: "metadata", metadata: { provider: "anthropic", event: parsed.type } };
  return undefined;
}

function splitSseEvents(buffer: string): { items: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  return { items: parts.slice(0, -1), remainder: parts.at(-1) ?? "" };
}

function numberEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listEnv(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}

function jsonEnv(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ANTHROPIC_EXTRA_JSON must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
