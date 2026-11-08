import { describe, expect, it } from "vitest";
import { Agent, type Model, type ModelInput, type ModelOutput } from "../src/index.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import type { FocusReranker } from "../src/agent/focusReranker.js";

class FixedModel implements Model {
  async complete(_input: ModelInput): Promise<ModelOutput> { return { text: "FINAL: done" }; }
  async *stream(_input: ModelInput) { yield { type: "token" as const, token: "FINAL: done" }; }
}

function weaveWithMemory(): { weave: CausalWeave; oldId: string } {
  const weave = new CausalWeave();
  const root = weave.append({ kind: "system", payload: "instructions", parents: [], advance: false });
  const old = weave.append({ kind: "semantic", payload: { type: "memory", key: "pilot", content: "Cedar is the pilot city." }, parents: [root.id], resourceKey: "semantic:memory:pilot", advance: false });
  for (let index = 0; index < 20; index++) {
    weave.append({ kind: "goal", payload: `Recent unrelated project ${index}`, parents: [root.id] });
  }
  return { weave, oldId: old.id };
}

describe("custom focus reranking", () => {
  it("can promote an old candidate without changing the graph or default projection", () => {
    const { weave, oldId } = weaveWithMemory();
    const before = weave.snapshot();
    const baseline = weave.compile({ query: "Where was the first test?", maxNodes: 8, contextMode: "molecular" });
    const shortlist = weave.focusCandidates("Where was the first test?");
    expect(shortlist.some((candidate) => candidate.id === oldId)).toBe(true);
    const focused = weave.compile({ query: "Where was the first test?", maxNodes: 8, contextMode: "molecular", preferredNodeIds: [oldId] });
    expect(focused.nodeIds).toContain(oldId);
    expect(focused.nodeIds.length).toBeLessThanOrEqual(8);
    expect(weave.compile({ query: "Where was the first test?", maxNodes: 8, contextMode: "molecular" })).toEqual(baseline);
    expect(weave.snapshot()).toEqual(before);
  });

  it("runs an Agent turn with custom focus and exposes ranking diagnostics", async () => {
    const { weave, oldId } = weaveWithMemory();
    const events: string[] = [];
    const focusReranker: FocusReranker = async (_query, candidates) => ({
      model: "test-focus", inputTokens: 40, outputTokens: 4,
      scores: candidates.map((candidate) => ({ id: candidate.id, relevance: candidate.id === oldId ? 0.99 : 0.01 }))
    });
    const agent = new Agent({
      model: new FixedModel(), tools: [], state: weave.snapshot(), projectionMaxNodes: 8, contextMode: "molecular", enforceCompletionEvidence: false,
      focusReranker
    });
    const result = await agent.run("Where was the first test?", { onProgress: (event) => {
      if (event.focus) events.push(event.focus.status);
      if (event.prompt) events.push(event.prompt.includes("Cedar is the pilot city.") ? "selected" : "absent");
    } });
    expect(events).toContain("ranked");
    expect(events).toContain("selected");
    expect(result.metadata.focus).toMatchObject({
      status: "ranked", preferredNodeIds: [oldId], selectedNodeIds: [oldId],
      ranking: { model: "test-focus", inputTokens: 40, outputTokens: 4 }
    });
    expect(result.metadata.recall?.status).toBe("lexical");
    expect(result.finalAnswer).toBe("done");
  });

  it("keeps the public agent working on a failed custom reranker and reports the fallback", async () => {
    const original = weaveWithMemory().weave.snapshot();
    const untouched = structuredClone(original);
    const progress: string[] = [];
    const agent = new Agent({ model: new FixedModel(), tools: [], state: original, focusReranker: async () => { throw new Error("private upstream error"); }, enforceCompletionEvidence: false });
    const result = await agent.run("Where was the first test?", { onProgress: (event) => { if (event.focus) progress.push(event.focus.status); } });
    expect(result.finalAnswer).toBe("done");
    expect(progress).toEqual(["fallback"]);
    expect(result.metadata.focus).toMatchObject({ status: "fallback", preferredNodeIds: [], selectedNodeIds: [], usageIncomplete: true });
    expect(JSON.stringify(result)).not.toContain("private upstream error");
    expect(original).toEqual(untouched);
  });
});
