import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import type { ContextRecovery } from "../src/agent/contextRecovery.js";
import type { Model } from "../src/llm/model.js";

const model: Model = { complete: async () => ({ text: "FINAL: OK" }), async *stream() { yield { type: "token", token: "FINAL: OK" }; } };
function fixture() {
  const weave = new CausalWeave();
  const root = weave.append({ kind: "system", payload: "Original records", parents: [], advance: true });
  for (let index = 0; index < 30; index++) weave.append({ kind: "resource", payload: { content: `Record ${index}: distinct archived item` }, parents: [root.id], resourceKey: `record:${index}`, advance: false });
  return weave.snapshot();
}
function agent(state = fixture(), contextRecovery?: ContextRecovery) {
  return new Agent({ model, state, tools: [], contextMode: "molecular", projectionMaxNodes: 8, enforceCompletionEvidence: false, contextRecovery });
}
afterEach(() => vi.useRealTimers());
it("preserves byte-identical prompts and original nodes with an empty optional recovery", async () => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-01-01"));
  const state = fixture();
  const baseline = await agent(state).run("Which record is relevant?");
  const recovered = await agent(state, async ({ state, compiled }) => { state.nodes.length = 0; compiled.prompt = "mutated callback copy"; return []; }).run("Which record is relevant?");
  expect(recovered.trace[0].prompt).toBe(baseline.trace[0].prompt);
  expect(recovered.state.nodes.slice(0, state.nodes.length)).toEqual(state.nodes);
});
it("recovers an existing source inside the same budget and exact action read set", async () => {
  let selected = "";
  const callback = vi.fn<ContextRecovery>(async ({ state, compiled }) => { selected = state.nodes.find(n => n.kind === "resource" && !compiled.nodeIds.includes(n.id))!.id; return [selected]; });
  const result = await agent(fixture(), callback).run("Which record is relevant?");
  expect(callback).toHaveBeenCalledOnce();
  expect(result.trace[0].nodeIds).toContain(selected);
  expect(result.trace[0].nodeIds.length).toBeLessThanOrEqual(8);
  expect(result.state.nodes.filter(n => n.kind === "answer").at(-1)!.parents).toEqual([...result.trace[0].nodeIds].sort());
});
it.each(["foreign", "duplicate", "too-many", "system", "throws"])("falls back without changing the prompt for %s", async (kind) => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-01-01"));
  const state = fixture();
  const baseline = await agent(state).run("Which record is relevant?");
  const callback: ContextRecovery = async ({ state }) => {
    const id = state.nodes.find(n => n.kind === "resource")!.id;
    if (kind === "throws") throw Error("Unavailable");
    if (kind === "foreign") return ["foreign-node"];
    if (kind === "duplicate") return [id, id];
    if (kind === "system") return [state.nodes.find(n => n.kind === "system")!.id];
    return Array(7).fill(id);
  };
  const result = await agent(state, callback).run("Which record is relevant?");
  expect(result.trace[0].prompt).toBe(baseline.trace[0].prompt);
});
it("propagates cancellation without committing a partial state", async () => {
  const state = fixture(), controller = new AbortController();
  const instance = agent(state, async () => { controller.abort(); return []; });
  await expect(instance.run("Which record?", { signal: controller.signal })).rejects.toThrow();
  expect(instance.getState()).toEqual(state);
});
it("runs recovery once across model retries", async () => {
  const complete = vi.fn().mockResolvedValueOnce({ text: "planning prose" }).mockResolvedValueOnce({ text: "FINAL: OK" });
  const contextRecovery = vi.fn<ContextRecovery>(async () => []);
  await new Agent({ model: { ...model, complete }, tools: [], state: fixture(), maxIterations: 2, contextRecovery, enforceCompletionEvidence: false }).run("Please inspect the relevant record.");
  expect(contextRecovery).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
});
