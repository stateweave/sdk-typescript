import type { FocusCandidate } from "../core/focusTypes.js";
export type { FocusCandidate } from "../core/focusTypes.js";
export type FocusRanking = { model: string; scores: { id: string; relevance: number }[]; inputTokens: number; outputTokens: number; latencyMs?: number };

/** Optional semantic judgment over a bounded shortlist. It never mutates causal state. */
export type FocusReranker = (query: string, candidates: FocusCandidate[], signal?: AbortSignal) => Promise<FocusRanking>;
