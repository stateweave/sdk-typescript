import type { FocusCandidate, FocusHierarchy } from "../core/focusTypes.js";
export type { FocusCandidate, FocusHierarchy } from "../core/focusTypes.js";
export type FocusStage = {
  kind: "topics" | "subgraphs" | "atoms";
  model: string;
  scores: { id: string; relevance: number }[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};
export type FocusRanking = {
  model: string;
  scores: { id: string; relevance: number }[];
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  candidateIds?: string[];
  mode?: "flat" | "hierarchical";
  stages?: FocusStage[];
};
export type FocusDiagnostics = {
  status: "ranked" | "fallback";
  ranking?: FocusRanking;
  preferredNodeIds: string[];
  selectedNodeIds: string[];
  latencyMs: number;
  completedStages?: FocusStage[];
  usageIncomplete?: boolean;
};
export type FocusUsage = { status: "ranked" | "fallback"; mode: "flat" | "hierarchical" | "custom"; calls: number; inputTokens: number; outputTokens: number; latencyMs: number; usageIncomplete: boolean };
export function summarizeFocus(focus: FocusDiagnostics): FocusUsage {
  const stages = focus.ranking?.stages ?? focus.completedStages ?? [];
  return { status: focus.status, mode: focus.ranking?.mode ?? "custom", calls: stages.length,
    inputTokens: focus.ranking?.inputTokens ?? stages.reduce((sum, stage) => sum + stage.inputTokens, 0),
    outputTokens: focus.ranking?.outputTokens ?? stages.reduce((sum, stage) => sum + stage.outputTokens, 0),
    latencyMs: focus.latencyMs, usageIncomplete: focus.usageIncomplete === true };
}
export class FocusRankingError extends Error {
  constructor(message: string, readonly completedStages: FocusStage[]) { super(message); this.name = "FocusRankingError"; }
}

/** Optional judgment over source-backed candidates; never authority to mutate state. */
export type FocusReranker = (query: string, candidates: FocusCandidate[], signal?: AbortSignal, hierarchy?: FocusHierarchy) => Promise<FocusRanking>;
