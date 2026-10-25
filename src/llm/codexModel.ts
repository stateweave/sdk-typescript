import type { Model, ModelInput, ModelOutput, ModelToken, ModelUsage } from "./model.js";

export const codexResponsesUrl = "https://chatgpt.com/backend-api/codex/responses";

export type CodexSelection = { model: string; reasoningEffort?: string };
export type CodexHeadersProvider = (selection: CodexSelection) => Promise<Record<string, string>>;
export type CodexUsage = ModelUsage & { reasoningTokens: number };

export class CodexModelError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "CodexModelError";
  }
}

export class CodexResponsesModel implements Model {
  constructor(
    private readonly selection: CodexSelection,
    private readonly headers: CodexHeadersProvider,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async complete(input: ModelInput): Promise<ModelOutput> {
    const tokens: string[] = [];
    let usage: ModelUsage | undefined;
    for await (const event of this.stream(input)) {
      if (event.type === "token") tokens.push(event.token);
      else if (event.metadata.usage) usage = event.metadata.usage as ModelUsage;
    }
    return { text: tokens.join(""), ...(usage ? { usage } : {}) };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    const headers = await this.headers(this.selection);
    input.signal?.throwIfAborted();
    const response = await this.fetcher(codexResponsesUrl, {
      method: "POST",
      headers,
      redirect: "error",
      signal: input.signal,
      body: JSON.stringify({
        model: this.selection.model,
        store: false,
        stream: true,
        instructions: input.system?.trim() || "Follow the user's instructions exactly.",
        tools: [],
        tool_choice: "none",
        ...(this.selection.reasoningEffort ? { reasoning: { effort: this.selection.reasoningEffort } } : {}),
        input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }] }]
      })
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new CodexModelError("Codex declined this connection. Reconnect your subscription.", 401);
      if (response.status === 429) throw new CodexModelError("Your Codex subscription is at its usage limit. Wait before trying again.", 429);
      throw new CodexModelError(`Codex is unavailable (HTTP ${response.status}). No result was accepted.`);
    }
    yield* parseCodexStream(response.body, this.selection.model, input.signal);
  }
}

export async function* parseCodexStream(body: AsyncIterable<Uint8Array>, model: string, signal?: AbortSignal): AsyncIterable<ModelToken> {
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  for await (const chunk of body) {
    signal?.throwIfAborted();
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      const event = parseLine(line);
      if (!event) continue;
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") yield { type: "token", token: event.delta };
      else if (event.type === "response.completed") {
        completed = true;
        const usage = normalizeCodexUsage(event.response?.usage);
        yield { type: "metadata", metadata: { provider: "codex", event: event.type, model, ...(usage ? { usage } : {}) } };
      } else if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
        throw new CodexModelError("Codex did not finish this response. No partial result was accepted.");
      }
    }
  }
  if (!completed) throw new CodexModelError("The Codex response was interrupted. No partial result was accepted.");
}

type CodexStreamEvent = { type?: string; delta?: unknown; response?: { usage?: unknown } };

function parseLine(line: string): CodexStreamEvent | undefined {
  if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") return undefined;
  try {
    return JSON.parse(line.slice(6)) as CodexStreamEvent;
  } catch {
    throw new CodexModelError("Codex sent an invalid stream event.");
  }
}

export function normalizeCodexUsage(raw: unknown): CodexUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown }; output_tokens_details?: { reasoning_tokens?: unknown } };
  if (typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") return undefined;
  const cached = typeof usage.input_tokens_details?.cached_tokens === "number" ? usage.input_tokens_details.cached_tokens : 0;
  const reasoning = typeof usage.output_tokens_details?.reasoning_tokens === "number" ? usage.output_tokens_details.reasoning_tokens : 0;
  return {
    inputTokens: usage.input_tokens,
    uncachedInputTokens: usage.input_tokens - cached,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: 0,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    reasoningTokens: reasoning
  };
}
