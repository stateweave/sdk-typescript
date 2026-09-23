import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import { createJevFocusReranker } from "../src/integrations/jevFocus.js";
import type { Model, ModelInput, ModelOutput } from "../src/llm/model.js";

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

describe("opt-in Jev focus", () => {
  it("can promote a judged old candidate without changing the graph or disabled projection", () => {
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

  it("sends only bounded candidates to the fixed TypeSafe endpoint and maps calibrated Noul probabilities", async () => {
    const requests: { url: unknown; headers: HeadersInit | undefined; body: unknown }[] = [];
    const rerank = createJevFocusReranker({ apiKey: "fake-for-test", fetch: async (url, init) => {
      requests.push({ url, headers: init?.headers, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ model: "jev-latest", answers: {
        candidate_0: { type: "noul", noul: 0.12 }, candidate_1: { type: "noul", noul: 0.91 }
      }, usage: { input_tokens: 182, output_tokens: 15 } }), { status: 200 });
    } });
    const result = await rerank("pilot", [
      { id: "a", kind: "memory", text: "irrelevant", sequence: 1 },
      { id: "b", kind: "memory", text: "Cedar pilot", sequence: 2 }
    ]);
    expect(result.scores).toEqual([{ id: "a", relevance: 0.12 }, { id: "b", relevance: 0.91 }]);
    expect(result.inputTokens).toBe(182);
    expect(requests[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("fake-for-test");
    expect(requests[0]?.body).toMatchObject({ model: "jev-latest", state: { query: "pilot" } });
  });

  it("runs a real Agent turn with judged focus and exposes ranking diagnostics", async () => {
    const { weave, oldId } = weaveWithMemory();
    const events: string[] = [];
    const agent = new Agent({
      model: new FixedModel(), tools: [], state: weave.snapshot(), projectionMaxNodes: 8, contextMode: "molecular", enforceCompletionEvidence: false,
      focusReranker: async (_query, candidates) => ({ model: "jev-latest", inputTokens: 40, outputTokens: 4,
        scores: candidates.map((candidate) => ({ id: candidate.id, relevance: candidate.id === oldId ? 0.99 : 0.01 })) })
    });
    const result = await agent.run("Where was the first test?", { onProgress: (event) => {
      if (event.focus) events.push(event.focus.status);
      if (event.prompt) events.push(event.prompt.includes("Cedar is the pilot city.") ? "selected" : "absent");
    } });
    expect(events).toContain("ranked");
    expect(events).toContain("selected");
    expect(result.finalAnswer).toBe("done");
  });

  it("keeps the public agent working on a failed sidecar and reports the fallback", async () => {
    const original = weaveWithMemory().weave.snapshot();
    const untouched = structuredClone(original);
    const progress: string[] = [];
    const agent = new Agent({ model: new FixedModel(), tools: [], state: original, focusReranker: async () => { throw new Error("private upstream error"); }, enforceCompletionEvidence: false });
    const result = await agent.run("Where was the first test?", { onProgress: (event) => { if (event.focus) progress.push(event.focus.status); } });
    expect(result.finalAnswer).toBe("done");
    expect(progress).toEqual(["fallback"]);
    expect(original).toEqual(untouched);
  });

  it("rejects malformed upstream data rather than accepting invalid rankings", async () => {
    const rerank = createJevFocusReranker({ apiKey: "fake", fetch: async () => new Response(JSON.stringify({ model: "jev-latest", answers: { candidate_0: { type: "noul", noul: 3 } } }), { status: 200 }) });
    await expect(rerank("q", [{ id: "a", kind: "memory", text: "text", sequence: 1 }])).rejects.toThrow("Invalid TypeSafe focus score");
  });
});
