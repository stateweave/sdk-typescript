import { AnthropicModel, normalizeAnthropicUsage, type AnthropicUsage } from "../../src/llm/anthropicModel.js";
import type { Model, ModelInput, ModelOutput, ModelToken, ModelUsage } from "../../src/llm/model.js";
import { estimateStateWeaveTokens } from "../../src/llm/tokenizer.js";
import type { MessagesEntry, MessagesModel, MessagesModelOutput } from "./runner.js";

export type ZaiLiveConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  maxProviderCalls: number;
  maxReservedTokens: number;
};

export type BudgetSnapshot = {
  providerCalls: number;
  reservedTokens: number;
  knownInputTokens: number;
  knownOutputTokens: number;
  knownTotalTokens: number;
  maxProviderCalls: number;
  maxReservedTokens: number;
};

type Reservation = { promptTokens: number; reservedTokens: number };

type AnthropicCompatibleResponse = {
  id?: unknown;
  model?: unknown;
  stop_reason?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { message?: unknown; type?: unknown };
};

export class LiveBudget {
  private providerCalls = 0;
  private reservedTokens = 0;
  private knownInputTokens = 0;
  private knownOutputTokens = 0;

  constructor(private readonly config: Pick<ZaiLiveConfig, "maxProviderCalls" | "maxReservedTokens">) {}

  reserve(promptTokens: number, maxOutputTokens: number): Reservation {
    const reservedTokens = promptTokens + maxOutputTokens;
    if (this.providerCalls + 1 > this.config.maxProviderCalls) {
      throw new Error(`Live provider-call ceiling exceeded: ${this.providerCalls + 1} > ${this.config.maxProviderCalls}.`);
    }
    if (this.reservedTokens + reservedTokens > this.config.maxReservedTokens) {
      throw new Error(`Live reserved-token ceiling exceeded: ${this.reservedTokens + reservedTokens} > ${this.config.maxReservedTokens}.`);
    }
    this.providerCalls += 1;
    this.reservedTokens += reservedTokens;
    return { promptTokens, reservedTokens };
  }

  recordUsage(usage: ModelUsage | undefined): void {
    if (!usage) return;
    this.knownInputTokens += usage.inputTokens;
    this.knownOutputTokens += usage.outputTokens;
  }

  snapshot(): BudgetSnapshot {
    return {
      providerCalls: this.providerCalls,
      reservedTokens: this.reservedTokens,
      knownInputTokens: this.knownInputTokens,
      knownOutputTokens: this.knownOutputTokens,
      knownTotalTokens: this.knownInputTokens + this.knownOutputTokens,
      maxProviderCalls: this.config.maxProviderCalls,
      maxReservedTokens: this.config.maxReservedTokens
    };
  }
}

export class ZaiGraphModel implements Model {
  private readonly inner: AnthropicModel;

  constructor(private readonly config: ZaiLiveConfig, private readonly budget: LiveBudget) {
    this.inner = new AnthropicModel({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      maxTokens: config.maxOutputTokens,
      temperature: 0,
      timeoutMs: config.timeoutMs,
      redirect: "error"
    });
  }

  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new Error("Z.ai Graph evaluation requires streaming served-model and stop-reason evidence.");
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    this.budget.reserve(estimateGraphPromptTokens(input), this.config.maxOutputTokens);
    const rawUsage: AnthropicUsage = {};
    let servedModel = "";
    let stopReason = "";
    for await (const event of this.inner.stream(input)) {
      if (event.type === "metadata") {
        if (event.metadata.event === "message_start") {
          servedModel = typeof event.metadata.model === "string" ? event.metadata.model : "";
          if (servedModel !== this.config.model) throw new Error(`Z.ai served model mismatch: expected ${this.config.model}, received ${servedModel || "unknown"}.`);
        }
        if (event.metadata.event === "message_delta" && typeof event.metadata.stopReason === "string") stopReason = event.metadata.stopReason;
        mergeRawUsage(rawUsage, event.metadata.usage);
        yield { type: "metadata", metadata: { ...event.metadata, provider: "zai" } };
      } else {
        yield event;
      }
    }
    if (!servedModel || !stopReason) throw new Error("Z.ai stream omitted served model or stop reason.");
    this.budget.recordUsage(normalizeAnthropicUsage(rawUsage));
  }
}

export class ZaiMessagesModel implements MessagesModel {
  constructor(private readonly config: ZaiLiveConfig, private readonly budget: LiveBudget) {}

  async complete(input: { system: string; messages: MessagesEntry[]; signal?: AbortSignal }): Promise<MessagesModelOutput> {
    const promptTokens = estimateMessagesPromptTokens(input);
    this.budget.reserve(promptTokens, this.config.maxOutputTokens);
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      redirect: "error",
      signal,
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxOutputTokens,
        temperature: 0,
        stream: false,
        system: input.system,
        messages: input.messages.map((entry) => ({ role: entry.role, content: entry.content }))
      })
    });
    const body = await response.json().catch(() => ({})) as AnthropicCompatibleResponse;
    if (!response.ok) throw new Error(`Z.ai request failed (${response.status}): ${errorText(body)}`);

    const model = typeof body.model === "string" ? body.model : "";
    const stopReason = typeof body.stop_reason === "string" ? body.stop_reason : "";
    if (!model || !stopReason) throw new Error("Z.ai response omitted served model or stop reason.");
    if (model !== this.config.model) throw new Error(`Z.ai served model mismatch: expected ${this.config.model}, received ${model}.`);
    const usage = normalizeAnthropicUsage(body.usage);
    this.budget.recordUsage(usage);
    const text = body.content?.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text as string).join("") ?? "";
    return {
      text,
      provider: "zai",
      model,
      stopReason,
      ...(usage ? { usage } : {}),
      metadata: {
        id: typeof body.id === "string" ? body.id : undefined,
        model,
        stopReason,
        usage: body.usage
      }
    };
  }
}

export function zaiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ZaiLiveConfig {
  const apiKey = env.ANTHROPIC_API_KEY ?? "";
  const baseUrl = env.ANTHROPIC_BASE_URL ?? "";
  const model = env.ANTHROPIC_MODEL ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required inside the authorized runtime.");
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "api.z.ai" || endpoint.pathname.replace(/\/$/, "") !== "/api/anthropic" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Authorized live run requires the exact HTTPS api.z.ai/api/anthropic endpoint without credentials, query, or fragment.");
  }
  if (model !== "glm-5.3-flash") throw new Error(`Authorized live run requires glm-5.3-flash, received ${model || "unset"}.`);
  return {
    apiKey,
    baseUrl,
    model,
    maxOutputTokens: 4_096,
    timeoutMs: 180_000,
    maxProviderCalls: 240,
    maxReservedTokens: 5_000_000
  };
}

function estimateGraphPromptTokens(input: ModelInput): number {
  return estimateStateWeaveTokens([input.system ? `SYSTEM:\n${input.system}` : "", `USER:\n${input.prompt}`].filter(Boolean).join("\n\n")).estimatedTokens;
}

function estimateMessagesPromptTokens(input: { system: string; messages: MessagesEntry[] }): number {
  const rendered = [input.system, ...input.messages.map((entry) => `${entry.role.toUpperCase()}:\n${entry.content}`)].join("\n\n");
  return estimateStateWeaveTokens(rendered).estimatedTokens;
}

function mergeRawUsage(target: AnthropicUsage, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const source = value as AnthropicUsage;
  for (const key of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const) {
    if (typeof source[key] === "number") target[key] = source[key];
  }
}

function errorText(body: AnthropicCompatibleResponse): string {
  return typeof body.error?.message === "string" ? body.error.message : "unknown error";
}
