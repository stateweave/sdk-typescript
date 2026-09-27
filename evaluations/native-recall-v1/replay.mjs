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
assert.notDeepEqual(candidateHashes, manifest.runtime, 'Compare distinct frozen and hardened runtimes.');
const runtimes = await Promise.all([frozenDist, candidateDist].map(async dist => ({ Agent: (await import(path.join(dist, 'agent/agent.js'))).Agent, Weave: (await import(path.join(dist, 'core/causalWeave.js'))).CausalWeave })));
assert.notEqual(runtimes[0].Agent, runtimes[1].Agent);
globalThis.fetch = async () => { throw new Error('Offline replay forbids network calls.'); };
const rows = [];
for (const file of fs.readdirSync(cohort).filter(name => /^c_[a-f0-9]{16}\.json$/.test(name)).sort()) {
  const source = load(path.join(cohort, file));
  const input = load(path.join(root, source.id + '.input.json'));
  for (const arm of ['lexical', 'native']) {
    const record = load(path.join(root, source.id + '.' + arm + '.result.json'));
    assert.equal(record.status, 'done');
    const original = record.result;
    const base = { version: 1, nodes: original.state.nodes.slice(0, source.sources.length + 1), frontier: [] };
    const byId = new Map(original.state.nodes.map(node => [node.id, node]));
    const outputs = [];
    for (const runtime of runtimes) {
      const append = runtime.Weave.prototype.append;
      runtime.Weave.prototype.append = function (value) {
        const node = append.call(this, value);
        const old = byId.get(node.id);
        assert.ok(old, 'Replay created an unrecorded causal node.');
        this.nodes.get(node.id).createdAt = old.createdAt;
        return structuredClone(this.nodes.get(node.id));
      };
      let calls = 0, jevCalls = 0;
      const model = { complete: async modelInput => {
        const step = original.trace[calls++];
        assert.ok(step);
        assert.equal(modelInput.prompt, step.prompt, 'Recorded model-facing prompt was not reproduced.');
        return { text: step.rawModelOutput, usage: { inputTokens: original.metadata.totalInputTokens, outputTokens: original.metadata.outputTokens } };
      } };
      const fetch = async (url, options) => {
        jevCalls++;
        const requestName = fs.readdirSync(root).find(name => name.startsWith(source.id + '.native.jev-') && name.endsWith('.request.json'));
        assert.ok(requestName);
        const request = load(path.join(root, requestName));
        assert.equal(String(url), request.url);
        assert.deepEqual(JSON.parse(options.body), request.body, 'Jev input changed.');
        const response = load(path.join(root, requestName.replace('.request.json', '.response.json')));
        return new Response(JSON.stringify(response.body), { status: response.status });
      };
      try {
        const agent = new runtime.Agent({ state: base, model, tools: [], maxIterations: 2, systemPrompt: 'Answer the current question using the supplied historical conversation evidence. Distinguish assistant suggestions and future plans from completed user actions. If necessary evidence is missing, say so. Answer concisely and specifically.', enforceCompletionEvidence: false, projectionMaxNodes: 48, projectionTargetTokens: 16_000, maxPromptTokens: 64_000, contextMode: 'causal', jev: { apiKey: 'offline-replay-not-a-credential', fetch } });
        if (arm === 'lexical') Object.defineProperty(agent, 'jev', { value: { rank: async (_query, candidates) => ({ model: 'lexical-ablation', scores: candidates.map((candidate, index) => ({ id: candidate.id, relevance: 1 - index / candidates.length })), inputTokens: 0, outputTokens: 0 }) } });
        const result = await agent.run(input.query);
        assert.equal(calls, original.trace.length);
        assert.equal(jevCalls, arm === 'native' ? 1 : 0);
        assert.deepEqual(result.trace, original.trace);
        assert.deepEqual(result.state, original.state);
        assert.equal(result.finalAnswer, original.finalAnswer);
        const { latencyMs: _latency, ...recall } = result.metadata.recall;
        const { latencyMs: _originalLatency, ...originalRecall } = original.metadata.recall;
        assert.deepEqual(recall, originalRecall);
        outputs.push(result);
      } finally { runtime.Weave.prototype.append = append; }
    }
    assert.deepEqual(outputs[0].state, outputs[1].state);
    rows.push({ id: source.id, arm, originalTraceReproduced: true, stateAndAnswerIdentical: true, traceSha256: hash(JSON.stringify(original.trace)) });
  }
}
console.log(JSON.stringify({ sourceCommit: manifest.commit, frozenRuntime: manifest.runtime, candidateRuntime: candidateHashes, clockPolicy: 'Replay restores each recorded node timestamp solely to reproduce the existing clock-dependent cluster summaries. It never changes original evidence or performs a model call.', scope: 'Differential engineering replay, not new efficacy evidence or general lifecycle certification.', networkCalls: 0, replayed: rows.length, rows }, null, 2));
