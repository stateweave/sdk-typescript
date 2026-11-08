// Provider usage accounting for the causal Agent: streamed output collection and token totals.
import type { Model, ModelInput, ModelOutput, ModelUsage } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { AgentModelEvent, TokenCountSource } from "./types.js";

export async function collectStreamedModelOutput(model: Model, input: ModelInput, iteration: number, onModelEvent: ((event: AgentModelEvent) => void) | undefined): Promise<ModelOutput> {
  const tokens: string[] = [];
  const metadata: Record<string, unknown>[] = [];
  for await (const event of model.stream(input)) {
    if (event.type === "token") {
      tokens.push(event.token);
      onModelEvent?.({ type: "token", iteration, token: event.token });
    } else {
      metadata.push(event.metadata);
      onModelEvent?.({ type: "metadata", iteration, metadata: event.metadata });
    }
  }
  const usage = usageFromStreamMetadata(metadata);
  return { text: tokens.join(""), ...(usage ? { usage } : {}) };
}

/** Accepted spellings per usage field; the first finite number wins, and later events override earlier ones. */
const usageFields = {
  normalizedInput: ["inputTokens"],
  rawInput: ["input_tokens"],
  output: ["outputTokens", "output_tokens"],
  uncached: ["uncachedInputTokens", "uncached_input_tokens"],
  cacheRead: ["cacheReadInputTokens", "cache_read_input_tokens"],
  cacheCreation: ["cacheCreationInputTokens", "cache_creation_input_tokens"]
} as const;

type UsageField = keyof typeof usageFields;
type LatestUsage = Partial<Record<UsageField, number>>;

function usageFromStreamMetadata(events: Record<string, unknown>[]): ModelUsage | undefined {
  let provider: string | undefined;
  const latest: LatestUsage = {};
  for (const event of events) {
    provider ??= typeof event.provider === "string" ? event.provider : undefined;
    const nested = asRecord(event.usage);
    const usage = Object.keys(nested).length ? nested : event;
    for (const field of Object.keys(usageFields) as UsageField[]) {
      const value = usageFields[field].map((key) => numberValue(usage[key])).find((item) => item !== undefined);
      if (value !== undefined) latest[field] = value;
    }
  }
  return totalUsage(latest, provider);
}

function totalUsage(latest: LatestUsage, provider: string | undefined): ModelUsage | undefined {
  const inputTokens = latest.normalizedInput ?? latest.rawInput;
  const outputTokens = latest.output;
  if (inputTokens === undefined || inputTokens <= 0 || outputTokens === undefined) return undefined;
  const uncachedInputTokens = latest.uncached ?? (provider === "anthropic" ? latest.rawInput : undefined);
  const totalInputTokens = uncachedInputTokens === undefined ? inputTokens : uncachedInputTokens + (latest.cacheRead ?? 0) + (latest.cacheCreation ?? 0);
  return {
    inputTokens: totalInputTokens,
    outputTokens,
    totalTokens: totalInputTokens + outputTokens,
    ...(uncachedInputTokens === undefined ? {} : { uncachedInputTokens }),
    ...(latest.cacheRead === undefined ? {} : { cacheReadInputTokens: latest.cacheRead }),
    ...(latest.cacheCreation === undefined ? {} : { cacheCreationInputTokens: latest.cacheCreation })
  };
}

/** Running token counters for one Agent run. */
export class UsageMeter {
  modelCalls = 0;
  toolCalls = 0;
  latestContextTokens = 0;
  peakContextTokens = 0;
  totalInputTokens = 0;
  outputTokens = 0;
  private providerUsageCalls = 0;

  record(output: ModelOutput, estimatedContextTokens: number): void {
    this.modelCalls += 1;
    if (output.usage) this.providerUsageCalls += 1;
    this.latestContextTokens = output.usage?.inputTokens ?? estimatedContextTokens;
    this.peakContextTokens = Math.max(this.peakContextTokens, this.latestContextTokens);
    this.totalInputTokens += this.latestContextTokens;
    this.outputTokens += output.usage?.outputTokens ?? estimateStateWeaveTokens(output.text).estimatedTokens;
  }

  get tokenCountSource(): TokenCountSource {
    if (this.providerUsageCalls === 0) return "estimated";
    return this.providerUsageCalls === this.modelCalls ? "provider" : "mixed";
  }

  totals(): { modelCalls: number; toolCalls: number; latestContextTokens: number; peakContextTokens: number; totalInputTokens: number; outputTokens: number; tokenCountSource: TokenCountSource } {
    const { modelCalls, toolCalls, latestContextTokens, peakContextTokens, totalInputTokens, outputTokens } = this;
    return { modelCalls, toolCalls, latestContextTokens, peakContextTokens, totalInputTokens, outputTokens, tokenCountSource: this.tokenCountSource };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
