import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const [root, cohort, frozenDist, candidateDist] = process.argv.slice(2).map(value => path.resolve(value));
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const manifest = load(path.join(root, 'manifest.json'));
for (const [file, expected] of Object.entries(manifest.runtime)) assert.equal(hash(fs.readFileSync(path.join(frozenDist, file))), expected);
const candidateHashes = Object.fromEntries(Object.keys(manifest.runtime).map(file => [file, hash(fs.readFileSync(path.join(candidateDist, file)))]));
for (const file of ['core/unicodeText.js', 'core/unicodeText.d.ts', 'core/unicodeText.js.map', 'core/unicodeText.d.ts.map']) candidateHashes[file] = hash(fs.readFileSync(path.join(candidateDist, file)));
assert.notDeepEqual(candidateHashes, manifest.runtime);
const runtimes = await Promise.all([frozenDist, candidateDist].map(async dist => ({
  Agent: (await import(path.join(dist, 'agent/agent.js'))).Agent,
  Weave: (await import(path.join(dist, 'core/causalWeave.js'))).CausalWeave,
  prepareRecall: (await import(path.join(dist, 'core/recallProjection.js'))).prepareRecall,
  SetupError: (await import(path.join(dist, 'integrations/jevRecall.js'))).JevSetupError
})));
assert.notEqual(runtimes[0].Agent, runtimes[1].Agent);
const wellFormed = value => !/[\uD800-\uDFFF]/u.test(value);
globalThis.fetch = async () => { throw new Error('Offline Unicode replay forbids network calls.'); };
const rows = [], indices = [];
const files = fs.readdirSync(root);
for (const file of fs.readdirSync(cohort).filter(name => /^c_[a-f0-9]{16}\.json$/.test(name)).sort()) {
  const source = load(path.join(cohort, file));
  const input = load(path.join(root, source.id + '.input.json'));
  assert.equal(hash(fs.readFileSync(path.join(cohort, file))), input.participantSha256);
  const reference = load(path.join(root, source.id + '.native.result.json'));
  const state = reference.status === 'done' ? reference.result.state : reference.committedState;
  const base = { version: 1, nodes: state.nodes.slice(0, source.sources.length + 1), frontier: [] };
  assert.deepEqual(runtimes[0].prepareRecall(base, input.query), input.candidateIndex);
  const next = runtimes[1].prepareRecall(base, input.query);
  const unchanged = JSON.stringify(next) === JSON.stringify(input.candidateIndex);
  assert.deepEqual(next.sourceNodeIds, input.candidateIndex.sourceNodeIds);
  for (const window of next.candidates) {
    assert.ok(wellFormed(window.text) && wellFormed(window.sourcePrefix));
    const original = base.nodes.find(node => node.id === window.nodeId).payload;
    assert.equal(window.text, original.slice(window.start, window.end));
    assert.ok(window.end - window.start <= 1600 && window.sourcePrefix.length <= 240);
  }
  indices.push({ id: source.id, candidateIndexUnchanged: unchanged, scalarSafeExactSourceWindows: true });
  for (const arm of ['lexical', 'native']) {
    const record = load(path.join(root, source.id + '.' + arm + '.result.json'));
    if (record.status !== 'done') {
      rows.push({ id: source.id, arm, status: 'failed_original_not_replayed' });
      continue;
    }
    const original = record.result;
    const originalBase = { version: 1, nodes: original.state.nodes.slice(0, source.sources.length + 1), frontier: [] };
    const byId = new Map(original.state.nodes.map(node => [node.id, node]));
    const outcomes = [];
    for (const [runtimeIndex, runtime] of runtimes.entries()) {
      const append = runtime.Weave.prototype.append;
      runtime.Weave.prototype.append = function(value) {
        const node = append.call(this, value);
        const old = byId.get(node.id);
        assert.ok(old, 'Replay created an unrecorded causal node.');
        this.nodes.get(node.id).createdAt = old.createdAt;
        return structuredClone(this.nodes.get(node.id));
      };
      let calls = 0, jevCalls = 0, changedInput = null;
      const model = { complete: async modelInput => {
        const step = original.trace[calls++];
        assert.ok(step);
        if (changedInput || modelInput.prompt !== step.prompt) {
          changedInput ??= 'main';
          throw new Error('Changed input cannot receive recorded model output.');
        }
        return { text: step.rawModelOutput, usage: { inputTokens: original.metadata.totalInputTokens, outputTokens: original.metadata.outputTokens } };
      } };
      const fetch = async (url, options) => {
        jevCalls++;
        const name = files.find(name => name.startsWith(source.id + '.native.jev-') && name.endsWith('.request.json'));
        assert.ok(name);
        const request = load(path.join(root, name));
        assert.equal(String(url), request.url);
        if (JSON.stringify(JSON.parse(options.body)) !== JSON.stringify(request.body)) {
          changedInput = 'jev';
          throw new runtime.SetupError('Offline replay detected changed Jev input.');
        }
        const responseFile = path.join(root, name.replace('.request.json', '.response.json'));
        if (!fs.existsSync(responseFile)) {
          assert.ok(fs.existsSync(path.join(root, name.replace('.request.json', '.error.json'))));
          throw new Error('Recorded transport failed; no provider replay.');
        }
        const response = load(responseFile);
        return new Response(JSON.stringify(response.body), { status: response.status });
      };
      try {
        const agent = new runtime.Agent({ state: originalBase, model, tools: [], maxIterations: 2, systemPrompt: 'Answer the current question using the supplied historical conversation evidence. Distinguish assistant suggestions and future plans from completed user actions. If necessary evidence is missing, say so. Answer concisely and specifically.', enforceCompletionEvidence: false, projectionMaxNodes: 48, projectionTargetTokens: 16_000, maxPromptTokens: 64_000, contextMode: 'causal', jev: { apiKey: 'offline-replay-not-a-credential', fetch } });
        if (arm === 'lexical') Object.defineProperty(agent, 'jev', { value: { rank: async (_query, candidates) => ({ model: 'lexical-ablation', scores: candidates.map((candidate, index) => ({ id: candidate.id, relevance: 1 - index / candidates.length })), inputTokens: 0, outputTokens: 0 }) } });
        const result = await agent.run(input.query);
        assert.equal(changedInput, null);
        assert.equal(calls, original.trace.length);
        assert.equal(jevCalls, arm === 'native' ? 1 : 0);
        assert.deepEqual(result.trace, original.trace);
        assert.deepEqual(result.state, original.state);
        assert.equal(result.finalAnswer, original.finalAnswer);
        const { latencyMs: _latency, ...recall } = result.metadata.recall;
        const { latencyMs: _originalLatency, ...originalRecall } = original.metadata.recall;
        assert.deepEqual(recall, originalRecall);
        outcomes.push('original_trace_reproduced');
      } catch (error) {
        if (!runtimeIndex || !changedInput) throw error;
        outcomes.push('changed_' + changedInput + '_input_not_replayed');
      } finally { runtime.Weave.prototype.append = append; }
    }
    rows.push({ id: source.id, arm, frozen: outcomes[0], candidate: outcomes[1], originalTraceSha256: hash(JSON.stringify(original.trace)) });
  }
}
const transportRepairs = [];
for (const { id } of indices.filter(row => !row.candidateIndexUnchanged)) {
  const input = load(path.join(root, id + '.input.json'));
  for (const arm of ['lexical', 'native']) {
    const original = load(path.join(root, id + '.' + arm + '.result.json'));
    if (original.status === 'done') continue;
    const state = original.committedState;
    let mainCalls = 0, jevCalls = 0;
    const agent = new runtimes[1].Agent({ state, tools: [], maxIterations: 2, enforceCompletionEvidence: false, contextMode: 'causal', projectionMaxNodes: 48, projectionTargetTokens: 16_000, maxPromptTokens: 64_000,
      systemPrompt: 'Answer the current question using the supplied historical conversation evidence. Distinguish assistant suggestions and future plans from completed user actions. If necessary evidence is missing, say so. Answer concisely and specifically.',
      model: { complete: async ({ prompt }) => { mainCalls++; assert.ok(wellFormed(prompt)); return { text: 'FINAL: OFFLINE UNICODE TRANSPORT CHECK ONLY' }; } },
      jev: { apiKey: 'offline-not-a-credential', fetch: async (_url, options) => {
        jevCalls++;
        const request = JSON.parse(options.body);
        const check = value => { if (typeof value === 'string') assert.ok(wellFormed(value)); else if (value && typeof value === 'object') Object.values(value).forEach(check); };
        check(request);
        return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul', noul: .5 }])), usage: { input_tokens: 1, output_tokens: 1 } }));
      } }
    });
    if (arm === 'lexical') Object.defineProperty(agent, 'jev', { value: { rank: async (_query, candidates) => ({ model: 'lexical-ablation', scores: candidates.map((candidate, index) => ({ id: candidate.id, relevance: 1 - index / candidates.length })), inputTokens: 0, outputTokens: 0 }) } });
    const result = await agent.run(input.query);
    assert.equal(mainCalls, 1);
    assert.equal(jevCalls, arm === 'native' ? 1 : 0);
    assert.deepEqual(result.state.nodes.slice(0, state.nodes.length), state.nodes);
    transportRepairs.push({ id, arm, simulated: true, scalarSafeTransport: true, originalSourceNodesUnchanged: true, substitutesForOriginalScore: false });
  }
}
console.log(JSON.stringify({ sourceCommit: manifest.commit, frozenRuntime: manifest.runtime, candidateRuntime: candidateHashes,
  clockPolicy: 'Restore original node timestamps solely to reproduce clock-sensitive hierarchy labels.',
  scope: 'Post-run engineering only: exact-source scalar-boundary checks plus differential replay of unchanged successful inputs. Failed arms and changed inputs receive no substitute answer or score; timing and usage are not remeasured. Not new live efficacy or general lifecycle certification.',
  networkCalls: 0, cases: indices.length, indexChanges: indices.filter(row => !row.candidateIndexUnchanged).length,
  originalSuccesses: rows.filter(row => row.frozen).length,
  candidateExactReplays: rows.filter(row => row.candidate === 'original_trace_reproduced').length,
  failedOriginalsNotReplayed: rows.filter(row => row.status).length, transportRepairs, indices, rows }, null, 2));
