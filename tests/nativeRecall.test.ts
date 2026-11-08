import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as sdk from '../src/index.js';
import { Agent } from '../src/agent/agent.js';
import type { AgentArgs } from '../src/agent/types.js';
import { CausalWeave } from '../src/core/causalWeave.js';
import { prepareRecall, selectRecall, validateRecallProjection } from '../src/core/recallProjection.js';
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

describe('local source recall', () => {
  it('constructs and runs an ordinary Agent without a ranking key or transport', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const transport = vi.fn(() => { throw new Error('Unexpected external request'); });
    vi.stubGlobal('fetch', transport);
    const result = await new Agent({ model: model(() => 'FINAL: hi'), tools: [] }).run('Say hi.');
    expect(result.finalAnswer).toBe('hi');
    expect(result.metadata.recall?.status).toBe('empty');
    expect(transport).not.toHaveBeenCalled();
    expect(sdk).not.toHaveProperty('createJevFocusReranker');
    expect(sdk).not.toHaveProperty('JevSetupError');
    expectTypeOf<'jev' extends keyof AgentArgs ? true : false>().toEqualTypeOf<false>();
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

  it.each(['causal', 'molecular'] as const)('selects historical source windows locally with exact parents in %s mode', async contextMode => {
    const { weave, current } = fixture();
    const original = weave.snapshot();
    const transport = vi.fn(() => { throw new Error('Unexpected ranking request'); });
    vi.stubGlobal('fetch', transport);
    const agent = new Agent({ model: model(input => { expect(input.prompt).toContain('Kyoto'); return 'FINAL: Kyoto'; }), state: original, tools: [], contextMode, enforceCompletionEvidence: false });
    const progress: string[] = [];
    const result = await agent.run('What is the approved launch city?', { onProgress: event => { if (event.recall) progress.push(event.recall.status); } });
    expect(transport).not.toHaveBeenCalled();
    expect(result.metadata.recall).toMatchObject({ status: 'lexical', reason: 'Deterministic lexical source recall; no external ranking request.' });
    expect(result.metadata.recall).not.toHaveProperty('ranking');
    expect(progress).toContain('lexical');
    expect(result.state.nodes.slice(0, original.nodes.length)).toEqual(original.nodes);
    expect(result.state.nodes.at(-1)!.parents).toEqual([...result.trace[0]!.nodeIds].sort());
    expect(result.trace[0]!.nodeIds).toContain(current.id);
    expect(result.metadata.recall!.visibleWindowIds!.length).toBeGreaterThan(0);
  });

  it('retains ordinary projection for a small source state without a transport', async () => {
    const weave = new CausalWeave();
    weave.append({ kind: 'resource', payload: 'The launch city is Kyoto.', advance: false });
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const result = await new Agent({ state: weave.snapshot(), tools: [], model: model(input => { expect(input.prompt).toContain('Kyoto'); return 'FINAL: Kyoto'; }) }).run('What is the launch city?');
    expect(result.metadata.recall?.status).toBe('small_state');
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not commit an aborted turn and preserves reset-generation fencing', async () => {
    const original = fixture().weave.snapshot();
    const controller = new AbortController();
    const complete = vi.fn(({ signal }: ModelInput) => new Promise<never>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }));
    const agent = new Agent({ state: original, tools: [], model: { complete, async *stream() {} } });
    const running = agent.run('What is the approved launch city?', { signal: controller.signal });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    agent.reset();
    controller.abort();
    await expect(running).rejects.toThrow();
    expect(agent.getState()).toBeUndefined();
  });

  it('does not let retrieval suppress or excerpt away the immediately preceding correction', () => {
    const weave = new CausalWeave();
    weave.append({ kind: 'system', payload: 'Keep source provenance.' });
    const correction = weave.append({ kind: 'goal', payload: 'Actually, Friday—not Monday.' });
    const acknowledgment = weave.append({ kind: 'answer', payload: 'Noted.' });
    for (let i = 0; i < 70; i++) weave.append({ kind: 'resource', resourceKey: `older-plan:${i}`, payload: `Project launch was proposed for Monday. Archived proposal ${i}.`, advance: false });
    const index = prepareRecall(weave.snapshot(), 'When is the project launch?');
    expect(index.candidates.some(window => window.nodeId === correction.id)).toBe(false);
    const windows = selectRecall(index).windows;
    weave.append({ kind: 'goal', payload: 'When is the project launch?' });
    const clipped = { id: 'rw_' + createHash('sha256').update(`${correction.id}:0:9`).digest('hex').slice(0, 20), nodeId: correction.id, kind: correction.kind, start: 0, end: 9, text: 'Actually,', sourcePrefix: correction.payload as string, lexicalScore: 0 };
    for (const contextMode of ['causal', 'molecular'] as const) {
      for (const selected of [windows, [...windows.slice(0, 11), clipped]]) {
        const compiled = weave.compile({ query: 'When is the project launch?', maxNodes: 16, contextMode, recall: { sourceNodeIds: index.sourceNodeIds, windows: selected } });
        expect(compiled.nodeIds).toContain(correction.id);
        expect(compiled.nodeIds).toContain(acknowledgment.id);
        expect(compiled.prompt).toContain('Actually, Friday—not Monday.');
        expect(compiled.nodeIds.length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('rejects fabricated span ends and duplicate windows while labeling short prefixes exactly', () => {
    const weave = new CausalWeave();
    const node = weave.append({ kind: 'resource', payload: 'The exact source text.', advance: false });
    const source = node.payload as string;
    const span = (start: number, end: number) => ({ id: 'rw_' + createHash('sha256').update(`${node.id}:${start}:${end}`).digest('hex').slice(0, 20), nodeId: node.id, kind: node.kind, start, end, text: source.slice(start, end), sourcePrefix: source, lexicalScore: 1 });
    const valid = span(4, source.length);
    expect(validateRecallProjection(weave.snapshot(), { sourceNodeIds: [node.id], windows: [valid] }).get(node.id)).toContain(`[Original source prefix, 0:${source.length}]`);
    expect(() => validateRecallProjection(weave.snapshot(), { sourceNodeIds: [node.id], windows: [span(4, source.length + 1)] })).toThrow('exact source spans');
    expect(() => validateRecallProjection(weave.snapshot(), { sourceNodeIds: [node.id], windows: [valid, valid] })).toThrow('identities');
    expect(() => validateRecallProjection(weave.snapshot(), { sourceNodeIds: [node.id], windows: [span(0, 10), span(5, 15)] })).toThrow('packing');
    const index = prepareRecall(weave.snapshot(), 'exact source');
    expect(() => selectRecall(index, index.candidates.map(row => ({ id: row.id, relevance: 2 })))).toThrow();
  });
});
