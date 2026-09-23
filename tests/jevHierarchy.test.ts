import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import { createJevFocusReranker } from "../src/integrations/jevFocus.js";
import type { FocusCandidate, FocusHierarchy } from "../src/core/focusTypes.js";
import type { Model } from "../src/llm/model.js";

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
function transport(requests: unknown[] = []): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "noul", noul: .9 }])), usage: { input_tokens: 100, output_tokens: 10 } }));
  };
}

describe("hierarchical Jev focus", () => {
  it("judges multiple topics, child subgraphs and atoms with separate additive costs", async () => {
    const requests: any[] = [];
    let topicIds: string[] = [], leafIds: string[] = [];
    const hierarchy: FocusHierarchy = {
      topics: [item("payments"), item("code"), item("noise")],
      children: (ids) => { topicIds = ids; return [item("rule"), item("change")]; },
      atoms: (ids) => { leafIds = ids; return [item("evidence-a"), item("evidence-b")]; }
    };
    const rank = await createJevFocusReranker({ apiKey: "test", mode: "hierarchical", fetch: transport(requests) })("duplicate charges", [item("base")], undefined, hierarchy);
    expect(topicIds).toEqual(["payments", "code", "noise"]);
    expect(leafIds).toEqual(["rule", "change"]);
    expect(rank.stages?.map((stage) => stage.kind)).toEqual(["topics", "subgraphs", "atoms"]);
    expect(rank.inputTokens).toBe(300); expect(rank.outputTokens).toBe(30);
    expect(rank.candidateIds).toEqual(["evidence-a", "evidence-b"]);
    expect(requests).toHaveLength(3);
  });

  it("constructs source-backed bounded regions without changing graph truth", () => {
    const weave = seed(), before = weave.snapshot(), hierarchy = weave.focusHierarchy("account setting");
    expect(hierarchy.topics.length).toBeLessThanOrEqual(16);
    expect(hierarchy.topics.every((topic) => topic.text.includes("Source excerpts") && topic.text.length <= 600)).toBe(true);
    expect(hierarchy.topics.every((topic) => !topic.text.includes("[goal]") && !topic.text.includes("[answer]"))).toBe(true);
    const leaves = hierarchy.children(hierarchy.topics.slice(0, 3).map((topic) => topic.id));
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
    expect(weave.focusCandidates("setting", 24, new Set([old.id,current.id])).map((node) => node.id)).toEqual([current.id]);
    expect(weave.get(old.id)).toEqual(old);
  });

  it("no matching branches still ranks the deterministic global shortlist", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "noul", noul: 0 }])), usage: { input_tokens: 10, output_tokens: 1 } }));
    };
    const result = await createJevFocusReranker({ apiKey: "test", mode: "hierarchical", fetch })("q",[item("bypass")],undefined,{ topics:[item("topic")], children:()=>[], atoms:()=>[] });
    expect(calls).toBe(2);expect(result.candidateIds).toEqual(["bypass"]);
  });

  it("preserves completed stage usage on fallback without leaking upstream details", async () => {
    let calls = 0;
    const good = transport();
    const rerank = createJevFocusReranker({ apiKey: "test", mode: "hierarchical", fetch: async (...args) => ++calls === 1 ? good(...args) : new Response("private upstream body",{status:503}) });
    const agent = new Agent({ model: fixed, tools: [], state: seed().snapshot(), focusReranker: rerank, enforceCompletionEvidence:false });
    const result = await agent.run("Which account setting?");
    expect(result.metadata.focus).toMatchObject({ status:"fallback",usageIncomplete:true,completedStages:[{inputTokens:100,outputTokens:10}] });
    expect(JSON.stringify(result)).not.toContain("private upstream body");
  });

  it("caller abort propagates and does not commit state", async () => {
    const abort = new AbortController();
    const agent = new Agent({ model: fixed, tools: [], state: seed().snapshot(), focusReranker: async () => {abort.abort();throw new Error("aborted");} });
    const before = agent.getState();
    await expect(agent.run("setting",{signal:abort.signal})).rejects.toThrow();
    expect(agent.getState()).toEqual(before);
  });

  it("rejects foreign IDs supplied by a custom scorer", async () => {
    const agent = new Agent({ model:fixed,tools:[],state:seed().snapshot(),enforceCompletionEvidence:false,focusReranker:async()=>({model:"test",inputTokens:1,outputTokens:1,candidateIds:["foreign"],scores:[{id:"foreign",relevance:1}]}) });
    expect((await agent.run("setting")).metadata.focus?.status).toBe("fallback");
  });

  it("fresh tool evidence outranks old preferences under a tight node ceiling", () => {
    const weave = seed();
    const preferred = weave.focusCandidates("setting").slice(0,6).map((node)=>node.id);
    const goal = weave.append({kind:"goal",payload:"Read the actual current setting"});
    const call = weave.append({kind:"tool_call",payload:{name:"read_file"},parents:[goal.id]});
    const result = weave.append({kind:"tool_result",payload:{content:"The setting is now disabled."},parents:[call.id]});
    const compiled=weave.compile({query:"setting",maxNodes:4,preferredNodeIds:preferred,contextMode:"molecular"});
    expect(compiled.nodeIds).toContain(result.id);
    expect(compiled.nodeIds.length).toBeLessThanOrEqual(4);
  });

  it("real Agent hierarchical selection records exact read parents and actual compiled preferences", async () => {
    const initial=seed().snapshot();
    const agent=new Agent({model:fixed,tools:[],state:initial,projectionMaxNodes:8,enforceCompletionEvidence:false,focusReranker:createJevFocusReranker({apiKey:"test",mode:"hierarchical",fetch:transport()})});
    const result=await agent.run("Which account setting?");
    expect(result.metadata.focus?.ranking?.stages).toHaveLength(3);
    expect(result.state.nodes.filter((node)=>node.kind==="answer").at(-1)?.parents.sort()).toEqual([...result.trace[0]!.nodeIds].sort());
    expect(result.metadata.focus?.selectedNodeIds.every((id)=>result.trace[0]!.nodeIds.includes(id))).toBe(true);
    expect(result.state.nodes.slice(0,initial.nodes.length)).toEqual(initial.nodes);
  });

  it("uses a single deadline across all hierarchy calls", async () => {
    const rerank=createJevFocusReranker({apiKey:"test",mode:"hierarchical",timeoutMs:100,fetch:async (_url,init)=> new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new Error("deadline")),{once:true}))});
    const start=Date.now();
    await expect(rerank("q",[item("a")],undefined,{topics:[item("t")],children:()=>[],atoms:()=>[]})).rejects.toThrow("TypeSafe focus unavailable");
    expect(Date.now()-start).toBeLessThan(1000);
  });
});
