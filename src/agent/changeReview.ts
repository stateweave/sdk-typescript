import type { CausalWeaveSnapshot } from "../core/causalTypes.js";

export type ChangeCandidate = { id: string; text: string };
export type ChangeReviewInput = {
  sources: ChangeCandidate[];
  candidates: ChangeCandidate[];
};
export type ChangeReviewResult = {
  model: string;
  scores: { id: string; contradiction: number }[];
  inputTokens: number;
  outputTokens: number;
};
export type ChangeReviewer = (input: ChangeReviewInput, signal?: AbortSignal) => Promise<ChangeReviewResult>;
export type ReviewDependency = { premiseId: string; dependentId: string };
export type ChangeReviewDiagnostics = {
  status: "reviewed" | "fallback" | "empty";
  sourceNodeIds: string[];
  candidateNodeIds: string[];
  flaggedNodeIds: string[];
  dependentNodeIds: string[];
  selectedNodeIds: string[];
  annotationNodeId?: string;
  result?: ChangeReviewResult;
  latencyMs: number;
  usageIncomplete?: boolean;
};

const stop = new Set("a an and are as at be been by can does for from has have in into is it its may of on or our that the their these this to was were which with would new evidence claim claims review paper statement statements".split(" "));
const terms = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g)?.filter(x => x.length > 2 && !stop.has(x)) ?? [];
const payloadText = (payload: unknown): string => typeof payload === "string" ? payload : JSON.stringify(payload);

export function prepareChangeReview(state: CausalWeaveSnapshot, sourceNodeIds: string[], limit = 64): ChangeReviewInput {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64 || !sourceNodeIds.length || sourceNodeIds.length > 4 || new Set(sourceNodeIds).size !== sourceNodeIds.length) throw new Error("Invalid change-review bounds.");
  const nodes = new Map(state.nodes.map(node => [node.id, node]));
  const heads = new Map(state.nodes.filter(node => node.resourceKey).map(node => [node.resourceKey!, node.id]));
  const sources = sourceNodeIds.map(id => {
    const node = nodes.get(id);
    if (!node || !["resource", "tool_result", "goal"].includes(node.kind) || (node.resourceKey && heads.get(node.resourceKey) !== id)) throw new Error("Change source must be a current existing resource, tool result, or goal.");
    const text = payloadText(node.payload);
    if (text.length > 12_000) throw new Error("Change source exceeds bounded review size.");
    return { id, text };
  });
  if (sources.reduce((sum, source) => sum + source.text.length, 0) > 24_000) throw new Error("Change sources exceed bounded review size.");
  const eligible = state.nodes.filter(node => {
    const p = node.payload as { type?: unknown } | null;
    return node.kind === "semantic" && p?.type !== "artifact" && (!node.resourceKey || heads.get(node.resourceKey) === node.id) && !sourceNodeIds.includes(node.id);
  }).map(node => ({ id: node.id, text: payloadText(node.payload) })).filter(node => node.text.length <= 1_200);
  const query = new Set(terms(sources.map(source => source.text).join(" ")));
  const bags = eligible.map(node => terms(node.text));
  const df = new Map<string, number>();
  for (const bag of bags) for (const term of new Set(bag)) df.set(term, (df.get(term) ?? 0) + 1);
  const avg = bags.reduce((sum, bag) => sum + bag.length, 0) / (bags.length || 1) || 1;
  return { sources, candidates: eligible.map((node, index) => {
    const bag = bags[index]!;
    const counts = new Map<string, number>();
    for (const term of bag) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of query) {
      const tf = counts.get(term) ?? 0;
      const frequency = df.get(term) ?? 0;
      score += Math.log(1 + (bags.length - frequency + 0.5) / (frequency + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * bag.length / avg));
    }
    return { node, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(item => item.node) };
}

export function validateChangeReview(input: ChangeReviewInput, result: ChangeReviewResult): void {
  const ids = new Set(input.candidates.map(candidate => candidate.id));
  if (typeof result.model !== "string" || !result.model.length || result.model.length > 80 || !Array.isArray(result.scores) || result.scores.length !== ids.size || new Set(result.scores.map(score => score.id)).size !== ids.size || result.scores.some(score => !ids.has(score.id) || !Number.isFinite(score.contradiction) || score.contradiction < 0 || score.contradiction > 1) || ![result.inputTokens, result.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid change-review result.");
}

export function propagateReview(state: CausalWeaveSnapshot, seeds: string[], dependencies: ReviewDependency[]): string[] {
  if (dependencies.length > 10_000 || seeds.length > 64) throw new Error("Review propagation exceeds bounds.");
  const nodes = new Map(state.nodes.map(node => [node.id, node]));
  const heads = new Map(state.nodes.filter(node => node.resourceKey).map(node => [node.resourceKey!, node.id]));
  const edges = new Map<string, string[]>();
  for (const { premiseId, dependentId } of dependencies) {
    const premise = nodes.get(premiseId), dependent = nodes.get(dependentId);
    if (!premise || !dependent || !dependent.parents.includes(premiseId)) throw new Error("Review dependencies must be caller-declared direct causal edges.");
    if (dependent.resourceKey && heads.get(dependent.resourceKey) !== dependent.id) continue;
    edges.set(premiseId, [...(edges.get(premiseId) ?? []), dependentId]);
  }
  if (seeds.some(id => !nodes.has(id))) throw new Error("Unknown review seed.");
  const visited = new Set(seeds), queue = [...seeds], affected: string[] = [];
  for (let index = 0; index < queue.length; index++) for (const id of edges.get(queue[index]!) ?? []) {
    if (visited.has(id)) continue;
    visited.add(id); queue.push(id); affected.push(id);
  }
  return affected;
}
