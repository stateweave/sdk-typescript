import type { FocusReranker } from "../agent/focusReranker.js";

const endpoint = "https://api.typesafe.ai/v1/systemone";

/** Server-only TypeSafe adapter. The key is never part of AgentState or a browser request. */
export function createJevFocusReranker(options: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }): FocusReranker {
  const key = options.apiKey.trim();
  if (!key) throw new Error("TypeSafe requires a server-side API key.");
  const transport = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error("Invalid TypeSafe timeout.");
  return async (query, candidates, signal) => {
    if (!candidates.length || candidates.length > 24 || query.length > 4_000 || candidates.some((candidate) => candidate.text.length > 600)) {
      throw new Error("TypeSafe focus request exceeds its bounds.");
    }
    const questions = Object.fromEntries(candidates.map((candidate, index) => [`candidate_${index}`, {
      type: "noul",
      instructions: `Could candidate ${index + 1} contain evidence needed to answer the user's current request? Evaluate \`candidates[${index}].text\` in relation to \`query\`.`,
      criteria: {
        true: "The candidate contributes specific evidence needed for the request, including a relevant correction or connected fact.",
        false: "Only a broad topic or words overlap, without evidence useful for the request."
      }
    }]));
    const startedAt = Date.now();
    const response = await transport(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: { query, candidates: candidates.map(({ kind, text }) => ({ kind, text })) }, questions }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`TypeSafe focus unavailable (HTTP ${response.status}).`);
    const payload = await response.json() as { model?: unknown; answers?: Record<string, { type?: unknown; noul?: unknown }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    if (typeof payload.model !== "string" || !payload.answers || typeof payload.answers !== "object") throw new Error("Invalid TypeSafe focus response.");
    const scores = candidates.map((candidate, index) => {
      const answer = payload.answers?.[`candidate_${index}`];
      const value = answer?.noul;
      if (answer?.type !== "noul" || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid TypeSafe focus score.");
      return { id: candidate.id, relevance: value };
    });
    return {
      model: payload.model,
      scores,
      inputTokens: validTokens(payload.usage?.input_tokens),
      outputTokens: validTokens(payload.usage?.output_tokens),
      latencyMs: Date.now() - startedAt
    };
  };
}

function validTokens(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
