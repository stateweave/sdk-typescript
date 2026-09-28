import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/agent/agent.js';
import { CausalWeave } from '../src/core/causalWeave.js';
import { prepareRecall, selectRecall, validateRecallProjection } from '../src/core/recallProjection.js';
import { isWellFormedUnicode, splitsSurrogatePair, utf16Prefix } from '../src/core/unicodeText.js';
import { createJevRecallClient } from '../src/integrations/jevRecall.js';

function fixture() {
  const units = ('MAPLE launch Kyoto. ' + 'x '.repeat(15_000)).split('');
  for (const offset of [239, 1_199, 1_599, 2_799, 3_999, 7_999]) {
    units[offset] = '\ud83c';
    units[offset + 1] = '\udf08';
  }
  const text = units.join('');
  const weave = new CausalWeave();
  const source = weave.append({ kind: 'resource', payload: text, resourceKey: 'source', advance: false });
  return { weave, source, text };
}

function checkStrings(value: unknown): void {
  if (typeof value === 'string') expect(isWellFormedUnicode(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(checkStrings);
  else if (value && typeof value === 'object') Object.values(value).forEach(checkStrings);
}

describe('native recall Unicode boundaries', () => {
  it('keeps UTF-16 bounds without splitting scalar values or replacing source characters', () => {
    expect(isWellFormedUnicode('a🌈e\u0301')).toBe(true);
    for (const broken of ['\ud83c', '\udf08', 'a\ud83cb', '\udf08\ud83c']) expect(isWellFormedUnicode(broken)).toBe(false);
    expect(splitsSurrogatePair('a🌈b', 2)).toBe(true);
    expect(utf16Prefix('a🌈b', 2)).toBe('a');
    expect(utf16Prefix('a🌈b', 3)).toBe('a🌈');
    expect(utf16Prefix('e\u0301', 1)).toBe('e');
    expect(utf16Prefix('abc', 20)).toBe('abc');
    expect(utf16Prefix('abc', 0)).toBe('');
    const { weave, text } = fixture();
    const before = weave.snapshot();
    expect(isWellFormedUnicode(text.slice(0, 1_600))).toBe(false);
    expect(isWellFormedUnicode(text.slice(1_200, 2_800))).toBe(false);
    expect(isWellFormedUnicode(text.slice(0, 240))).toBe(false);
    const index = prepareRecall(before, 'MAPLE');
    expect(index.candidates.find(window => window.start === 0)?.end).toBe(1_599);
    expect(index.candidates.some(window => window.start === 1_201)).toBe(true);
    for (const window of index.candidates) {
      expect(window.end - window.start).toBeLessThanOrEqual(1_600);
      expect(window.text).toBe(text.slice(window.start, window.end));
      expect(window.sourcePrefix).toBe(text.slice(0, 239));
      checkStrings(window);
    }
    validateRecallProjection(before, selectRecall(index));
    expect(weave.snapshot()).toEqual(before);
  });

  it('rejects forged half-scalar ranges even when their IDs and slices match', () => {
    const { weave, source, text } = fixture();
    const base = prepareRecall(weave.snapshot(), 'MAPLE').candidates[0]!;
    for (const [start, end] of [[0, 1_600], [1_200, 1_700]]) {
      const invalid = { ...base, nodeId: source.id, start: start!, end: end!, text: text.slice(start, end), id: 'rw_' + createHash('sha256').update(`${source.id}:${start}:${end}`).digest('hex').slice(0, 20) };
      expect(() => validateRecallProjection(weave.snapshot(), { sourceNodeIds: [source.id], windows: [invalid] })).toThrow('exact source spans');
    }
  });

  it('refuses malformed original text rather than silently replacing it', () => {
    const weave = new CausalWeave();
    weave.append({ kind: 'resource', payload: 'MAPLE \ud83c', advance: false });
    const original = weave.snapshot();
    expect(() => prepareRecall(original, 'MAPLE')).toThrow('invalid Unicode');
    expect(weave.snapshot()).toEqual(original);
    expect(() => prepareRecall({ version: 1, nodes: [], frontier: [] }, 'bad \udf08')).toThrow('invalid Unicode');
  });

  it('fails an Agent turn before transport while preserving malformed source truth', async () => {
    const weave = new CausalWeave();
    weave.append({ kind: 'resource', payload: 'MAPLE \ud83c', advance: false });
    const state = weave.snapshot();
    const complete = vi.fn(), transport = vi.fn();
    const agent = new Agent({ state, model: { complete, async *stream() { throw new Error('Unexpected stream.'); } }, tools: [], jev: { apiKey: 'unit-test-not-a-credential', fetch: transport } });
    await expect(agent.run('Where is MAPLE?')).rejects.toThrow('invalid Unicode');
    expect(agent.getState()).toEqual(state);
    expect(complete).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects malformed Jev inputs before any transport call', async () => {
    const transport = vi.fn();
    const client = createJevRecallClient({ apiKey: 'unit-test-not-a-credential', fetch: transport });
    const { weave } = fixture();
    const candidate = prepareRecall(weave.snapshot(), 'MAPLE').candidates[0]!;
    for (const [query, window] of [
      ['MAPLE \ud83c', candidate],
      ['MAPLE', { ...candidate, text: '\ud83c' }],
      ['MAPLE', { ...candidate, sourcePrefix: '\udf08' }]
    ] as const) await expect(client.rank(query, [window])).rejects.toThrow('invalid Unicode');
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps the shorter causal timeline excerpt well formed', () => {
    const weave = new CausalWeave();
    weave.append({ kind: 'resource', payload: 'x'.repeat(223) + '🌈' + 'a'.repeat(50), advance: false });
    weave.append({ kind: 'goal', payload: 'Read the source.' });
    expect(isWellFormedUnicode(weave.compile().prompt)).toBe(true);
  });

  for (const contextMode of ['causal', 'molecular'] as const) {
    it(`preserves scalar boundaries in ${contextMode} compiler truncation`, () => {
      const weave = new CausalWeave();
      const cap = contextMode === 'causal' ? 12_000 : 8_000;
      const original = 'x'.repeat(cap - 1) + '🌈tail';
      weave.append({ kind: 'resource', payload: original, resourceKey: 'source', advance: false });
      weave.append({ kind: 'goal', payload: 'Read the source.' });
      const before = weave.snapshot();
      const compiled = weave.compile({ contextMode, targetTokens: 16_000 });
      expect(isWellFormedUnicode(compiled.prompt)).toBe(true);
      expect(compiled.prompt.includes('...[6 characters omitted]')).toBe(true);
      expect(weave.snapshot()).toEqual(before);
    });

    it(`sends only well-formed excerpts and capped queries through the ${contextMode} Agent`, async () => {
      const { weave } = fixture();
      const state = weave.snapshot();
      const transport = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
        const body = JSON.parse(String(options?.body));
        checkStrings(body);
        expect(body.state.query).toHaveLength(7_999);
        return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'noul', noul: .5 }])), usage: { input_tokens: 1, output_tokens: 1 } }));
      });
      const complete = vi.fn(async ({ prompt }: { prompt: string }) => {
        expect(isWellFormedUnicode(prompt)).toBe(true);
        return { text: 'FINAL: Unicode-safe.' };
      });
      const agent = new Agent({ state, model: { complete, async *stream() { throw new Error('Unexpected streaming path.'); } }, tools: [], enforceCompletionEvidence: false, contextMode, jev: { apiKey: 'unit-test-not-a-credential', fetch: transport } });
      const result = await agent.run('MAPLE ' + 'x'.repeat(7_993) + '🌈 question');
      expect(result.finalAnswer).toBe('Unicode-safe.');
      expect(result.metadata.recall?.status).toBe('ranked');
      expect(transport).toHaveBeenCalledOnce();
      expect(complete).toHaveBeenCalledOnce();
      expect(result.state.nodes.slice(0, state.nodes.length)).toEqual(state.nodes);
    });
  }
});
