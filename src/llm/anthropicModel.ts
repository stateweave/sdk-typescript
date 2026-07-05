import type { Model, ModelInput, ModelOutput, ModelParameters, ModelToken } from "./model.js";

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

type AnthropicResponse = {
  content?: AnthropicContent[];
  error?: { message?: string; type?: string };
};

const defaultConfig = {
  baseUrl: "https://api.anthropic.com",
  version: "2023-06-01",
  model: "claude-3-5-sonnet-latest",
  maxTokens: 4096,
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
    return { text: readText(json) };
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
        const token = parseSseToken(event);
        if (token) yield { type: "token", token };
      }
    }

    buffer += decoder.decode();
    for (const event of splitSseEvents(`${buffer}\n\n`).items) {
      const token = parseSseToken(event);
      if (token) yield { type: "token", token };
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
      system: this.config.system ?? defaultSystem(),
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
  return "You are a precise, helpful assistant. Follow the user prompt's requested response format exactly.";
}

function readText(response: AnthropicResponse): string {
  return response.content?.filter((item): item is { type: "text"; text: string } => item.type === "text").map((item) => item.text).join("") ?? "";
}

function anthropicError(status: number, response: AnthropicResponse): string {
  return `Anthropic request failed (${status}): ${response.error?.message ?? "unknown error"}`;
}

function parseSseToken(event: string): string | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;

  const parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
  if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") return parsed.delta.text;
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
