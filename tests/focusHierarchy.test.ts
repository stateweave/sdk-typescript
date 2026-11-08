import { describe, expect, it } from "vitest";
import { Agent, type Model } from "../src/index.js";
import { FocusRankingError, summarizeFocus, type FocusReranker, type FocusStage } from "../src/agent/focusReranker.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import type { FocusCandidate, FocusHierarchy } from "../src/core/focusTypes.js";

const item = (id: string, text = id): FocusCandidate => ({ id, text, kind: "memory", sequence: 1 });
const fixed: Model = { complete: async () => ({ text: "FINAL: done" }), async *stream() { yield { type: "token", token: "FINAL: done" }; } };
function seed() {
  const weave = new CausalWeave();
  const root = weave.append({ kind: "system", payload: "instructions", parents: [], advance: false });
  for (let i = 0; i < 36; i++) {
    const goal = weave.append({ kind: "goal", payload: `Inspect records/topic${i}.md`, parents: [root.id] });
    weave.append({ kind: "semantic", payload: { type: "memory", key: `topic${i}`, content: `records/topic${i}.md stores the account setting ${i}.` }, parents: [goal.id], resourceKey: `semantic:memory:topic${i}`, advance: false });
  }
  return weave;
}

function stage(kind: FocusStage["kind"], candidates: FocusCandidate[]): FocusStage {
  return { kind, model: "test-focus", scores: candidates.map(({ id }) => ({ id, relevance: 0.9 })), inputTokens: 100, outputTokens: 10, latencyMs: 1 };
}

const rankHierarchy: FocusReranker = async (_query, candidates, _signal, hierarchy) => {
  if (!hierarchy) throw new Error("Expected a source-backed hierarchy");
  const topics = hierarchy.topics.slice(0, 3);
  const children = hierarchy.children(topics.map(({ id }) => id)).slice(0, 4);
  const atoms = hierarchy.atoms(children.map(({ id }) => id));
  const stages = [stage("topics", topics), stage("subgraphs", children), stage("atoms", atoms.length ? atoms : candidates)];
  return {
    model: "test-focus", mode: "hierarchical", stages,
    scores: stages[2]!.scores, candidateIds: stages[2]!.scores.map(({ id }) => id),
    inputTokens: stages.reduce((sum, entry) => sum + entry.inputTokens, 0),
    outputTokens: stages.reduce((sum, entry) => sum + entry.outputTokens, 0)
  };
};

describe("provider-agnostic focus hierarchy", () => {
  it("supports custom topic, subgraph and atom selection with additive stage accounting", async () => {
    let topicIds: string[] = [], leafIds: string[] = [];
    const hierarchy: FocusHierarchy = {
      topics: [item("payments"), item("code"), item("noise")],
      children: (ids) => { topicIds = ids; return [item("rule"), item("change")]; },
      atoms: (ids) => { leafIds = ids; return [item("evidence-a"), item("evidence-b")]; }
    };
    const ranking = await rankHierarchy("duplicate charges", [item("base")], undefined, hierarchy);
    expect(topicIds).toEqual(["payments", "code", "noise"]);
    expect(leafIds).toEqual(["rule", "change"]);
    expect(ranking.stages?.map((entry) => entry.kind)).toEqual(["topics", "subgraphs", "atoms"]);
    expect(ranking.candidateIds).toEqual(["evidence-a", "evidence-b"]);
    expect(summarizeFocus({ status: "ranked", ranking, preferredNodeIds: [], selectedNodeIds: [], latencyMs: 3 })).toEqual({
      status: "ranked", mode: "hierarchical", calls: 3, inputTokens: 300, outputTokens: 30, latencyMs: 3, usageIncomplete: false
    });
  });

  it("constructs source-backed bounded regions without changing graph truth", () => {
    const weave = seed(), before = weave.snapshot(), hierarchy = weave.focusHierarchy("account setting");
    expect(hierarchy.topics.length).toBeGreaterThan(0);
    expect(hierarchy.topics.length).toBeLessThanOrEqual(16);
    expect(hierarchy.topics.every((topic) => topic.text.includes("Source excerpts") && topic.text.length <= 600)).toBe(true);
    expect(hierarchy.topics.every((topic) => !topic.text.includes("[goal]") && !topic.text.includes("[answer]"))).toBe(true);
    const leaves = hierarchy.children(hierarchy.topics.slice(0, 3).map((topic) => topic.id));
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.length).toBeLessThanOrEqual(12);
    const atoms = hierarchy.atoms(leaves.slice(0, 4).map((leaf) => leaf.id));
    expect(atoms.length).toBeLessThanOrEqual(24);
    expect(atoms.every((atom) => before.nodes.some((node) => node.id === atom.id))).toBe(true);
    expect(atoms.map((atom) => atom.id)).toEqual(expect.arrayContaining(weave.focusCandidates("account setting").slice(0, 8).map((atom) => atom.id)));
    expect(weave.snapshot()).toEqual(before);
  });

  it("excludes superseded semantic values from every atom shortlist", () => {
    const weave = seed(), snapshot = weave.snapshot();
    const old = snapshot.nodes.find((node) => node.resourceKey === "semantic:memory:topic0")!;
    const current = weave.append({ kind: "semantic", payload: { type: "memory", key: "topic0", content: "Corrected setting: enabled" }, resourceKey: old.resourceKey, parents: [old.id], advance: false });
    const before = weave.snapshot();
    expect(weave.focusCandidates("setting", 24, new Set([old.id, current.id])).map((node) => node.id)).toEqual([current.id]);
    const hierarchy = weave.focusHierarchy("setting");
    for (const topic of hierarchy.topics) {
      const leaves = hierarchy.children([topic.id]);
      expect(hierarchy.atoms(leaves.map(({ id }) => id)).map(({ id }) => id)).not.toContain(old.id);
    }
    expect(weave.get(old.id)).toEqual(old);
    expect(weave.snapshot()).toEqual(before);
  });

  it("keeps the deterministic global shortlist when no branches match", () => {
    const weave = seed(), before = weave.snapshot(), hierarchy = weave.focusHierarchy("account setting");
    expect(hierarchy.children(["foreign-topic"])).toEqual([]);
    const atoms = hierarchy.atoms(["foreign-leaf"]);
    expect(atoms.map(({ id }) => id)).toEqual(weave.focusCandidates("account setting").map(({ id }) => id));
    expect(atoms.length).toBeLessThanOrEqual(24);
    expect(weave.snapshot()).toEqual(before);
  });

  it("preserves completed stage usage on fallback without leaking upstream details", async () => {
    const completedStages = [stage("topics", [item("topic")])];
    const rerank: FocusReranker = async () => { throw new FocusRankingError("private upstream body", completedStages); };
    const agent = new Agent({ model: fixed, tools: [], state: seed().snapshot(), focusReranker: rerank, enforceCompletionEvidence: false });
    const result = await agent.run("Which account setting?");
    expect(result.finalAnswer).toBe("done");
    expect(result.metadata.focus).toMatchObject({ status: "fallback", usageIncomplete: true, completedStages });
    expect(summarizeFocus(result.metadata.focus!)).toMatchObject({ status: "fallback", calls: 1, inputTokens: 100, outputTokens: 10, usageIncomplete: true });
    expect(JSON.stringify(result)).not.toContain("private upstream body");
  });

  it("caller abort propagates and does not commit state", async () => {
    const abort = new AbortController();
    const agent = new Agent({ model: fixed, tools: [], state: seed().snapshot(), focusReranker: async () => { abort.abort(); throw new Error("aborted"); } });
    const before = agent.getState();
    await expect(agent.run("setting", { signal: abort.signal })).rejects.toThrow();
    expect(agent.getState()).toEqual(before);
  });

  it("rejects foreign IDs supplied by a custom scorer", async () => {
    const agent = new Agent({
      model: fixed, tools: [], state: seed().snapshot(), enforceCompletionEvidence: false,
      focusReranker: async () => ({ model: "test-focus", inputTokens: 1, outputTokens: 1, candidateIds: ["foreign"], scores: [{ id: "foreign", relevance: 1 }] })
    });
    const result = await agent.run("setting");
    expect(result.metadata.focus).toMatchObject({ status: "fallback", preferredNodeIds: [], selectedNodeIds: [] });
    expect(result.trace[0]!.nodeIds).not.toContain("foreign");
  });

  it("fresh tool evidence outranks old preferences under a tight node ceiling", () => {
    const weave = seed();
    const preferred = weave.focusCandidates("setting").slice(0, 6).map((node) => node.id);
    const goal = weave.append({ kind: "goal", payload: "Read the actual current setting" });
    const call = weave.append({ kind: "tool_call", payload: { name: "read_file" }, parents: [goal.id] });
    const result = weave.append({ kind: "tool_result", payload: { content: "The setting is now disabled." }, parents: [call.id] });
    const before = weave.snapshot();
    const compiled = weave.compile({ query: "setting", maxNodes: 4, preferredNodeIds: preferred, contextMode: "molecular" });
    expect(compiled.nodeIds).toContain(result.id);
    expect(compiled.nodeIds.length).toBeLessThanOrEqual(4);
    expect(weave.snapshot()).toEqual(before);
  });

  it("Agent hierarchical selection records exact read parents and actual compiled preferences", async () => {
    const initial = seed().snapshot();
    const agent = new Agent({ model: fixed, tools: [], state: initial, projectionMaxNodes: 8, enforceCompletionEvidence: false, focusReranker: rankHierarchy });
    const result = await agent.run("Which account setting?");
    expect(result.metadata.focus?.status).toBe("ranked");
    expect(result.metadata.focus?.ranking?.stages).toHaveLength(3);
    expect(result.state.nodes.filter((node) => node.kind === "answer").at(-1)?.parents.sort()).toEqual([...result.trace[0]!.nodeIds].sort());
    expect(result.metadata.focus?.selectedNodeIds.length).toBeGreaterThan(0);
    expect(result.metadata.focus?.selectedNodeIds.every((id) => result.trace[0]!.nodeIds.includes(id))).toBe(true);
    expect(result.trace[0]!.nodeIds.length).toBeLessThanOrEqual(8);
    expect(result.state.nodes.slice(0, initial.nodes.length)).toEqual(initial.nodes);
  });
});
