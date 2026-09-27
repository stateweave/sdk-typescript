import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { prepareChangeReview, propagateReview, type ChangeReviewer } from "../src/agent/changeReview.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import { createJevChangeReviewer } from "../src/integrations/jevChangeReview.js";
import type { Model } from "../src/llm/model.js";

const model = { complete: async () => ({ text: 'FINAL: REVIEW: NONE' }) } as unknown as Model;
function fixture() {
  const weave = new CausalWeave();
  const root = weave.append({ kind: "system", payload: "Imported working state.", advance: false });
  const claim = weave.append({ kind: "semantic", payload: { type: "memory", key: "delivery", content: "Carrier accepts refrigerated parcels." }, resourceKey: "semantic:memory:delivery", parents: [root.id], advance: false });
  const note = weave.append({ kind: "semantic", payload: { type: "artifact", key: "plan", content: "Delivery plan" }, parents: [claim.id], advance: false });
  const report = weave.append({ kind: "semantic", payload: { type: "artifact", key: "report", content: "Shipment report" }, parents: [note.id], advance: false });
  const unrelated = weave.append({ kind: "semantic", payload: { type: "memory", key: "support", content: "Support opens Mondays." }, parents: [root.id], advance: false });
  const update = weave.append({ kind: "resource", payload: "Carrier refuses all refrigerated parcels.", resourceKey: "carrier:policy", parents: [root.id], advance: false });
  return { weave, root, claim, note, report, unrelated, update, dependencies: [{ premiseId: claim.id, dependentId: note.id }, { premiseId: note.id, dependentId: report.id }] };
}
const reviewer: ChangeReviewer = async input => ({ model: "jev-test", inputTokens: 100, outputTokens: 10, scores: input.candidates.map(candidate => ({ id: candidate.id, contradiction: candidate.text.includes("refrigerated") ? 0.96 : 0.02 })) });

describe("optional change-impact review", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("ranks bounded current claims, never artifact instructions", () => {
    const f = fixture(), input = prepareChangeReview(f.weave.snapshot(), [f.update.id]);
    expect(input.candidates.map(x => x.id)).toEqual([f.claim.id, f.unrelated.id]);
    expect(input.sources[0]!.text).toContain("refuses");
  });
  it("propagates only explicit caller-declared direct edges, transitively", () => {
    const f = fixture();
    expect(propagateReview(f.weave.snapshot(), [f.claim.id], f.dependencies)).toEqual([f.note.id, f.report.id]);
    expect(propagateReview(f.weave.snapshot(), [f.claim.id], [])).toEqual([]);
    expect(() => propagateReview(f.weave.snapshot(), [f.claim.id], [{ premiseId: f.unrelated.id, dependentId: f.note.id }])).toThrow("caller-declared");
  });
  it("keeps source graph unchanged and binds advisory plus answer ancestry", async () => {
    const f = fixture(), before = f.weave.snapshot();
    const agent = new Agent({ model, tools: [], state: before, changeReviewer: reviewer, enforceCompletionEvidence: false });
    const result = await agent.run("Which claims merit review?", { changedNodeIds: [f.update.id], reviewDependencies: f.dependencies });
    expect(result.state.nodes.slice(0, before.nodes.length)).toEqual(before.nodes);
    const diagnostics = result.metadata.changeReview!;
    expect(diagnostics.status).toBe("reviewed");
    expect(diagnostics.flaggedNodeIds).toEqual([f.claim.id]);
    expect(diagnostics.dependentNodeIds).toEqual([f.note.id, f.report.id]);
    expect(diagnostics.selectedNodeIds).toContain(f.claim.id);
    const annotation = result.state.nodes.find(n => n.id === diagnostics.annotationNodeId)!;
    expect(annotation.parents).toEqual([f.update.id, f.claim.id, f.unrelated.id].sort());
    expect(annotation.payload).toMatchObject({ status: "advisory_only" });
    expect(result.state.nodes.filter(n => n.kind === "answer").at(-1)!.parents).toEqual([...result.trace.at(-1)!.nodeIds].sort());
    expect(agent.getState()).toEqual(result.state);
  });
  it("composes review and focus preferences without cross-attributing their selected evidence", async () => {
    const f = fixture();
    for (const projectionMaxNodes of [5, 10]) {
      const agent = new Agent({ model, tools: [], state: f.weave.snapshot(), projectionMaxNodes, changeReviewer: reviewer,
        focusReranker: async (_query, candidates) => ({ model: "test-focus", inputTokens: 1, outputTokens: 1, scores: candidates.map(candidate => ({ id: candidate.id, relevance: candidate.id === f.unrelated.id ? 1 : 0 })) })
      });
      const result = await agent.run("Assess changes. Carrier refuses all refrigerated parcels.", { changedNodeIds: [f.update.id] });
      expect(result.metadata.focus!.preferredNodeIds).toEqual([f.unrelated.id]);
      expect(result.metadata.focus!.selectedNodeIds).toEqual(projectionMaxNodes === 5 ? [] : [f.unrelated.id]);
      expect(result.metadata.changeReview!.selectedNodeIds).toEqual([f.claim.id]);
      expect(result.trace[0]!.nodeIds.length).toBeLessThanOrEqual(projectionMaxNodes);
    }
  });
  it("does not attribute caller preferences to a failed focus provider", async () => {
    const f = fixture();
    const details: string[] = [];
    const result = await new Agent({ model, tools: [], state: f.weave.snapshot(), changeReviewer: reviewer, focusReranker: async () => { throw new Error("Unavailable"); } }).run("Assess changes.", { preferredNodeIds: [f.claim.id], changedNodeIds: [f.update.id], onProgress: event => { if (event.phase === "context") details.push(event.detail); } });
    expect(result.trace[0]!.nodeIds).toContain(f.claim.id);
    expect(result.metadata.focus!.selectedNodeIds).toEqual([]);
    expect(result.metadata.changeReview!.status).toBe("reviewed");
    expect(details).toContain("Focus ranking unavailable; compiled the available context");
  });
  it("does not run or change prompt bytes when disabled", async () => {
    const f = fixture(), state = f.weave.snapshot();
    let calls = 0;
    const enabled = new Agent({ model, tools: [], state, changeReviewer: async input => { calls++; return reviewer(input); } });
    const plain = new Agent({ model, tools: [], state });
    const a = await enabled.run("Summarize the current situation."), b = await plain.run("Summarize the current situation.");
    expect(calls).toBe(0); expect(a.trace[0]!.prompt).toBe(b.trace[0]!.prompt);
  });
  it("retains identical projection when no contradiction is nominated", async () => {
    const f = fixture(), state = f.weave.snapshot();
    const zero: ChangeReviewer = async input => ({ model: "test", inputTokens: 1, outputTokens: 1, scores: input.candidates.map(x => ({ id: x.id, contradiction: 0.1 })) });
    const a = await new Agent({ model, tools: [], state, changeReviewer: zero }).run("Assess changes.", { changedNodeIds: [f.update.id] });
    const b = await new Agent({ model, tools: [], state }).run("Assess changes.");
    expect(a.trace[0]!.prompt).toBe(b.trace[0]!.prompt); expect(a.metadata.changeReview!.flaggedNodeIds).toEqual([]);
  });
  it("rejects malformed, foreign, duplicate and non-finite callback scores without annotation", async () => {
    for (const defect of ["foreign", "duplicate", "nan", "usage"]) {
      const f = fixture();
      const bad: ChangeReviewer = async input => {
        const r = await reviewer(input);
        if (defect === "foreign") r.scores[0]!.id = "foreign";
        if (defect === "duplicate") r.scores[1]!.id = r.scores[0]!.id;
        if (defect === "nan") r.scores[0]!.contradiction = NaN;
        if (defect === "usage") r.inputTokens = -1;
        return r;
      };
      const r = await new Agent({ model, tools: [], state: f.weave.snapshot(), changeReviewer: bad }).run("Assess changes.", { changedNodeIds: [f.update.id] });
      expect(r.metadata.changeReview!.status).toBe("fallback");
      expect(r.state.nodes.filter(n => n.kind === "verification")).toHaveLength(0);
    }
  });
  it("isolates callback mutation of supplied inputs", async () => {
    const f = fixture();
    const mutating: ChangeReviewer = async input => { input.sources[0]!.id = "forged"; input.candidates[0]!.text = "poison"; return reviewer(input); };
    const before = f.weave.snapshot();
    const result = await new Agent({ model, tools: [], state: before, changeReviewer: mutating }).run("Assess changes.", { changedNodeIds: [f.update.id] });
    expect(result.state.nodes.slice(0, before.nodes.length)).toEqual(before.nodes);
  });
  it("propagates cancellation and never commits a failed run", async () => {
    const f = fixture(), state = f.weave.snapshot(), controller = new AbortController();
    const cancelled: ChangeReviewer = async input => { controller.abort(); return reviewer(input); };
    const agent = new Agent({ model, tools: [], state, changeReviewer: cancelled });
    await expect(agent.run("Assess changes.", { signal: controller.signal, changedNodeIds: [f.update.id] })).rejects.toThrow();
    expect(agent.getState()).toEqual(state);
    const broken = new Agent({ model: { complete: async () => { throw new Error("upstream failed"); } } as unknown as Model, tools: [], state, changeReviewer: reviewer });
    await expect(broken.run("Assess changes.", { changedNodeIds: [f.update.id] })).rejects.toThrow("upstream failed");
    expect(broken.getState()).toEqual(state);
  });
  it("does not silently rebind superseded targets or source versions", () => {
    const f = fixture();
    f.weave.append({ kind: "semantic", payload: { type: "memory", key: "delivery", content: "New policy." }, resourceKey: "semantic:memory:delivery", parents: [f.claim.id], advance: false });
    expect(prepareChangeReview(f.weave.snapshot(), [f.update.id]).candidates.map(n => n.id)).not.toContain(f.claim.id);
    f.weave.append({ kind: "resource", payload: "Newer source", resourceKey: "carrier:policy", parents: [f.update.id], advance: false });
    expect(() => prepareChangeReview(f.weave.snapshot(), [f.update.id])).toThrow("current");
  });
  it("expires old advice on source revision even when the next reviewer fails", async () => {
    const f = fixture();
    const first = await new Agent({ model, tools: [], state: f.weave.snapshot(), changeReviewer: reviewer }).run("Assess changes.", { changedNodeIds: [f.update.id] });
    const revised = new CausalWeave(first.state);
    const source = revised.append({ kind: "resource", payload: "Carrier accepts refrigerated parcels again.", resourceKey: "carrier:policy", parents: [f.update.id], advance: false });
    const result = await new Agent({ model, tools: [], state: revised.snapshot(), changeReviewer: async () => { throw new Error("Unavailable"); } }).run("Assess changes.", { changedNodeIds: [source.id] });
    expect(result.metadata.changeReview!.status).toBe("fallback");
    const last = result.state.nodes.filter(n => n.resourceKey?.startsWith("change-review:")).at(-1)!;
    expect(last.payload).toMatchObject({ status: "expired_source" });
    expect(result.trace[0]!.nodeIds).not.toContain(first.metadata.changeReview!.annotationNodeId);
    expect(result.state.nodes.slice(0, first.state.nodes.length)).toEqual(first.state.nodes);
  });
  it("traverses approved historical intermediates without flagging superseded outputs", () => {
    const f = fixture();
    const old = f.weave.append({ kind: "semantic", payload: { type: "artifact", content: "Old derived note" }, resourceKey: "note:versioned", parents: [f.claim.id], advance: false });
    const latest = f.weave.append({ kind: "semantic", payload: { type: "artifact", content: "Independent replacement" }, resourceKey: "note:versioned", parents: [old.id], advance: false });
    const currentReport = f.weave.append({ kind: "semantic", payload: { type: "artifact", content: "Still based on old note" }, resourceKey: "report:current", parents: [old.id], advance: false });
    const result = propagateReview(f.weave.snapshot(), [f.claim.id], [{ premiseId: f.claim.id, dependentId: old.id }, { premiseId: old.id, dependentId: currentReport.id }]);
    expect(result).toEqual([currentReport.id]);
    expect(result).not.toContain(old.id); expect(result).not.toContain(latest.id);
  });
  it("expires previous advice on candidate changes or revoked dependencies even if sources stay identical", async () => {
    for (const change of ["candidate", "dependencies", "reviewer"]) {
      const f = fixture();
      const first = await new Agent({ model, tools: [], state: f.weave.snapshot(), changeReviewer: reviewer }).run("Assess changes.", { changedNodeIds: [f.update.id], reviewDependencies: f.dependencies });
      const revised = new CausalWeave(first.state);
      if (change === "candidate") revised.append({ kind: "semantic", payload: { type: "memory", key: "delivery", content: "Carrier now refuses refrigerated parcels." }, resourceKey: "semantic:memory:delivery", parents: [f.claim.id], advance: false });
      const result = await new Agent({ model, tools: [], state: revised.snapshot(), changeReviewer: async () => { throw new Error("Unavailable"); } }).run("Assess changes.", { changedNodeIds: [f.update.id], reviewDependencies: change === "dependencies" ? [] : f.dependencies });
      const last = result.state.nodes.find(node => node.id === result.metadata.changeReview!.annotationNodeId)!;
      expect(last.payload).toMatchObject({ status: "expired_review" });
      expect(result.trace[0]!.nodeIds).not.toContain(first.metadata.changeReview!.annotationNodeId);
      expect(result.state.nodes.slice(0, first.state.nodes.length)).toEqual(first.state.nodes);
    }
  });
  it("keeps refreshed zero-nomination advice bounded and never declares the entire graph cleared", async () => {
    const f = fixture();
    const first = await new Agent({ model, tools: [], state: f.weave.snapshot(), changeReviewer: reviewer }).run("Assess changes.", { changedNodeIds: [f.update.id] });
    const zero: ChangeReviewer = async input => ({ model: "test", inputTokens: 1, outputTokens: 1, scores: input.candidates.map(x => ({ id: x.id, contradiction: 0 })) });
    const result = await new Agent({ model, tools: [], state: first.state, changeReviewer: zero }).run("Assess changes.", { changedNodeIds: [f.update.id] });
    expect(result.metadata.changeReview!.flaggedNodeIds).toEqual([]);
    const annotation = result.state.nodes.find(node => node.id === result.metadata.changeReview!.annotationNodeId)!;
    expect(JSON.stringify(annotation.payload)).toContain("not a complete graph clearance");
    expect(result.trace[0]!.nodeIds).not.toContain(first.metadata.changeReview!.annotationNodeId);
  });
  it("bounds projections, nominations and candidate scans in large histories", async () => {
    const f = fixture();
    for (let i = 0; i < 2500; i++) f.weave.append({ kind: "semantic", payload: { type: "memory", key: `m${i}`, content: `Carrier refrigerated logistics note ${i}.` }, parents: [f.root.id], advance: false });
    const input = prepareChangeReview(f.weave.snapshot(), [f.update.id]);
    expect(input.candidates).toHaveLength(64);
    const result = await new Agent({ model, tools: [], state: f.weave.snapshot(), changeReviewer: reviewer, projectionMaxNodes: 16 }).run("Assess carrier policy changes.", { changedNodeIds: [f.update.id] });
    expect(result.metadata.changeReview!.flaggedNodeIds.length).toBeLessThanOrEqual(5);
    expect(result.trace[0]!.nodeIds.length).toBeLessThanOrEqual(16);
    expect(result.trace[0]!.contextTokens).toBeLessThanOrEqual(64000);
  });
  it("validates exact response model and keeps credentials out of state/questions", async () => {
    const f = fixture(), input = prepareChangeReview(f.weave.snapshot(), [f.update.id]);
    let body = "";
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: Object.fromEntries(input.candidates.map((_, i) => [`q${i}`, { type: "noul", noul: 0.1 }])), usage: { input_tokens: 4, output_tokens: 2 } }));
    }) as typeof fetch;
    await createJevChangeReviewer({ apiKey: "unit-test-secret", fetch: fetcher })(input);
    expect(body).not.toContain("unit-test-secret"); expect(body).not.toContain(f.claim.id);
    await expect(createJevChangeReviewer({ apiKey: "x", model: "jev-other", fetch: fetcher })(input)).rejects.toThrow("identity");
  });
});
