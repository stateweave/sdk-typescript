import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/agent/agent.js';
import { CausalWeave } from '../src/core/causalWeave.js';
import { prepareRecall, selectRecall, validateRecallProjection } from '../src/core/recallProjection.js';
import { createJevRecallClient } from '../src/integrations/jevRecall.js';
import type { Model, ModelInput } from '../src/llm/model.js';

function fixture() {
  const weave = new CausalWeave();
  const root = weave.append({ kind: 'system', payload: 'Complete the task accurately.', advance: false });
  const old = weave.append({ kind: 'resource', resourceKey: 'target', payload: 'Launch city is Austin.', parents: [root.id], advance: false });
  const current = weave.append({ kind: 'resource', resourceKey: 'target', payload: 'Noise about unrelated gardens. '.repeat(300) + '\nThe approved launch city is Kyoto.\n' + 'More irrelevant background. '.repeat(200), parents: [root.id], advance: false });
  for (let i = 0; i < 15; i++) weave.append({ kind: 'resource', resourceKey: 'other:' + i, payload: `Unrelated project ${i}. ` + 'Background information about sports. '.repeat(40), parents: [root.id], advance: false });
  return { weave, old, current };
}
const model = (callback: (input: ModelInput) => string): Model => ({ complete: async input => ({ text: callback(input) }), async *stream(input) { yield { type: 'token', token: callback(input) }; } });
const scoringFetch = (): typeof fetch => vi.fn(async (_url, options) => {
  const request = JSON.parse(options!.body as string);
  return new Response(JSON.stringify({ model: request.model, answers: Object.fromEntries(Object.entries(request.questions).map(([key, value]) => [key, { type: 'noul', noul: JSON.stringify(value).includes('Kyoto') ? .99 : .01 }])), usage: { input_tokens: 100, output_tokens: 20 } }));
});

describe('native source recall', () => {
  it('requires credential setup for an ordinary Agent without any opt-in switch', () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    expect(() => new Agent({ model: model(() => 'FINAL: hi'), tools: [] })).toThrow('requires Jev setup');
    expect(() => new Agent({ model: model(() => 'FINAL: hi'), tools: [], jev: { apiKey: 'fixture' } })).not.toThrow();
  });

  it('finds deep exact spans while excluding superseded resource versions', () => {
    const { weave, current, old } = fixture();
    const index = prepareRecall(weave.snapshot(), 'What is the approved launch city?');
    expect(index.sourceNodeIds).not.toContain(old.id);
    expect(index.candidates[0]!.nodeId).toBe(current.id);
    expect(index.candidates[0]!.start).toBeGreaterThan(6_000);
    const before = weave.snapshot();
    const projection = selectRecall(index);
    expect(validateRecallProjection(before, projection).get(current.id)).toContain('Kyoto');
    expect(weave.snapshot()).toEqual(before);
    const altered = structuredClone(projection);
    altered.windows[0]!.text = 'invented';
    expect(() => validateRecallProjection(before, altered)).toThrow('exact source spans');
  });

  it.each(['causal', 'molecular'] as const)('renders original source IDs and only bounded exact views in %s mode', contextMode => {
    const { weave, current, old } = fixture();
    const projection = selectRecall(prepareRecall(weave.snapshot(), 'approved launch city'));
    weave.append({ kind: 'goal', payload: 'What is the approved launch city?' });
    const before = weave.snapshot();
    const compiled = weave.compile({ query: 'approved launch city', maxNodes: 16, targetTokens: 8_000, maxTokens: 8_000, contextMode, recall: projection });
    expect(compiled.prompt).toContain('Kyoto');
    expect(compiled.nodeIds).toContain(current.id);
    expect(compiled.nodeIds).not.toContain(old.id);
    expect(compiled.nodeIds.length).toBeLessThanOrEqual(16);
    expect(compiled.tokenEstimate.estimatedTokens).toBeLessThanOrEqual(8_000);
    expect(weave.snapshot()).toEqual(before);
  });

  it('never resurrects an old source view after a resource changes during a run', () => {
    const { weave, current } = fixture();
    const projection = selectRecall(prepareRecall(weave.snapshot(), 'approved launch city'));
    const changed = weave.append({ kind: 'resource', resourceKey: 'target', payload: 'The approved launch city is Oslo.', advance: true });
    weave.append({ kind: 'goal', payload: 'What is the approved launch city?' });
    const compiled = weave.compile({ query: 'approved launch city', recall: projection });
    expect(compiled.nodeIds).not.toContain(current.id);
    expect(compiled.nodeIds).toContain(changed.id);
    expect(compiled.prompt).not.toContain('Kyoto');
    expect(compiled.prompt).toContain('Oslo');
  });

  it('uses Jev automatically and records exact source parents without changing source truth', async () => {
    const { weave, current } = fixture();
    const original = weave.snapshot();
    const transport = scoringFetch();
    const agent = new Agent({ model: model(input => { expect(input.prompt).toContain('Kyoto'); return 'FINAL: Kyoto'; }), state: original, tools: [], jev: { fetch: transport }, enforceCompletionEvidence: false });
    const result = await agent.run('What is the approved launch city?');
    expect(transport).toHaveBeenCalledOnce();
    expect(result.metadata.recall?.status).toBe('ranked');
    expect(result.state.nodes.slice(0, original.nodes.length)).toEqual(original.nodes);
    expect(result.state.nodes.at(-1)!.parents).toEqual([...result.trace[0]!.nodeIds].sort());
    expect(result.trace[0]!.nodeIds).toContain(current.id);
    expect(result.metadata.recall!.visibleWindowIds!.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('unit-test-only-not-a-credential');
  });

  it('falls back transparently without losing state when Jev is unavailable', async () => {
    const { weave } = fixture();
    const original = weave.snapshot();
    const agent = new Agent({ state: original, tools: [], model: model(() => 'FINAL: Kyoto'), enforceCompletionEvidence: false });
    const result = await agent.run('What is the approved launch city?');
    expect(result.metadata.recall?.status).toBe('fallback');
    expect(result.metadata.recall?.reason).toContain('usage may be incomplete');
    expect(result.state.nodes.slice(0, original.nodes.length)).toEqual(original.nodes);
  });

  it('does not commit an aborted recall and preserves reset-generation fencing', async () => {
    const { weave } = fixture();
    const original = weave.snapshot();
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const agent = new Agent({ state: original, tools: [], model: model(() => 'FINAL: no'), jev: { fetch: transport } });
    const running = agent.run('What is the approved launch city?', { signal: controller.signal });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    agent.reset();
    controller.abort();
    finish(new Response('{}', { status: 503 }));
    await expect(running).rejects.toThrow();
    expect(agent.getState()).toBeUndefined();
  });

  it('rejects missing scores, invalid probabilities and mismatched provider identities', async () => {
    const { weave } = fixture();
    const index = prepareRecall(weave.snapshot(), 'launch city');
    for (const response of [{ model: 'wrong', answers: {} }, { model: 'jev-1.13.0', answers: {} }]) {
      const client = createJevRecallClient({ fetch: async () => new Response(JSON.stringify(response)) });
      await expect(client.rank('launch city', index.candidates)).rejects.toThrow();
    }
    expect(() => selectRecall(index, index.candidates.map(row => ({ id: row.id, relevance: 2 })))).toThrow();
  });
});
