// Per-run context selection for the causal Agent: lexical source recall and optional focus re-ranking.
import type { CausalWeave } from "../core/causalWeave.js";
import type { CausalWeaveSnapshot } from "../core/causalTypes.js";
import type { FocusCandidate } from "../core/focusTypes.js";
import { prepareRecall, selectRecall } from "../core/recallProjection.js";
import type { RecallDiagnostics, RecallProjection } from "../core/recallTypes.js";
import { utf16Prefix } from "../core/unicodeText.js";
import { FocusRankingError, type FocusDiagnostics, type FocusHierarchy, type FocusRanking, type FocusReranker } from "./focusReranker.js";

const FOCUS_CANDIDATES = 24;
const PREFERRED_NODES = 6;

export type RunRecall = { recall: RecallDiagnostics; projection?: RecallProjection };
export type RunFocus = { focus?: FocusDiagnostics; preferredNodeIds: string[] };

export function prepareRunRecall(snapshot: CausalWeaveSnapshot, task: string, limits: { maxNodes: number; targetTokens: number }): RunRecall {
  const started = Date.now();
  const index = prepareRecall(snapshot, utf16Prefix(task, 8_000) || "current task");
  const recall: RecallDiagnostics = { status: "empty", sourceNodes: index.sourceNodeIds.length, candidateWindows: index.candidates.length, selectedWindows: 0, omittedSourceNodes: index.omittedSourceNodes, latencyMs: 0 };
  let projection: RecallProjection | undefined;
  if (index.candidates.length) {
    const candidateChars = index.candidates.reduce((sum, row) => sum + row.text.length, 0);
    const smallState = index.windows <= 12 && index.sourceNodeIds.length <= limits.maxNodes - 2 && candidateChars <= limits.targetTokens;
    if (smallState) {
      Object.assign(recall, { status: "small_state", reason: "Small bounded state; retained ordinary projection without a provider request." });
    } else {
      projection = selectRecall(index);
      Object.assign(recall, { status: "lexical", reason: "Deterministic lexical source recall; no external ranking request.", selectedWindows: projection.windows.length });
    }
  }
  recall.latencyMs = Date.now() - started;
  return { recall, projection };
}

export async function rankFocus(weave: CausalWeave, reranker: FocusReranker | undefined, task: string, signal?: AbortSignal): Promise<RunFocus> {
  const candidates = reranker ? weave.focusCandidates(task, FOCUS_CANDIDATES) : [];
  if (!reranker || candidates.length <= 1) return { preferredNodeIds: [] };
  const started = Date.now();
  const issued = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  try {
    const ranking = await reranker(task, candidates, signal, trackedHierarchy(weave, task, issued));
    signal?.throwIfAborted();
    const preferredNodeIds = preferredFromRanking(ranking, candidates, issued);
    return { preferredNodeIds, focus: { status: "ranked", ranking, preferredNodeIds, selectedNodeIds: [], latencyMs: Date.now() - started } };
  } catch (error) {
    signal?.throwIfAborted();
    const completedStages = error instanceof FocusRankingError ? error.completedStages : [];
    return { preferredNodeIds: [], focus: { status: "fallback", preferredNodeIds: [], selectedNodeIds: [], latencyMs: Date.now() - started, completedStages, usageIncomplete: true } };
  }
}

/** A lazily built hierarchy that records every atom it hands out, so rankings may only cite issued ids. */
function trackedHierarchy(weave: CausalWeave, task: string, issued: Map<string, FocusCandidate>): FocusHierarchy {
  let regions: FocusHierarchy | undefined;
  const getRegions = (): FocusHierarchy => regions ??= weave.focusHierarchy(task);
  return {
    get topics() { return getRegions().topics; },
    children: (ids) => getRegions().children(ids),
    atoms: (ids) => {
      const atoms = getRegions().atoms(ids);
      for (const atom of atoms) issued.set(atom.id, atom);
      return atoms;
    }
  };
}

function preferredFromRanking(ranking: FocusRanking, candidates: FocusCandidate[], issued: Map<string, FocusCandidate>): string[] {
  const ids = ranking.candidateIds ?? candidates.map((candidate) => candidate.id);
  assertValidRanking(ranking, ids, issued);
  const baselineOrder = new Map(ids.map((id, index) => [id, index]));
  return [...ranking.scores]
    .filter((score) => score.relevance >= 0.5)
    .sort((a, b) => b.relevance - a.relevance || baselineOrder.get(a.id)! - baselineOrder.get(b.id)!)
    .slice(0, PREFERRED_NODES)
    .map((score) => score.id);
}

function assertValidRanking(ranking: FocusRanking, ids: string[], issued: Map<string, FocusCandidate>): void {
  const validIds = ids.length > 0 && ids.length <= FOCUS_CANDIDATES && new Set(ids).size === ids.length && ids.every((id) => issued.has(id));
  const validScore = (score: FocusRanking["scores"][number]) => ids.includes(score.id) && Number.isFinite(score.relevance) && score.relevance >= 0 && score.relevance <= 1;
  const validScores = ranking.scores.length === ids.length && ranking.scores.every(validScore) && new Set(ranking.scores.map((score) => score.id)).size === ids.length;
  if (!validIds || !validScores) throw new Error("Invalid focus ranking.");
}
