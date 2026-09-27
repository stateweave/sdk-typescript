import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { importEvidence } from './import-evidence.mjs';

const [root, cohort, dist] = process.argv.slice(2).map(value => path.resolve(value));
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const manifest = load(path.join(root, 'manifest.json'));
assert.ok(['answers', 'confirmatory', 'offline-harness'].includes(manifest.phase));
const split = manifest.phase === 'answers' ? 'development' : 'holdout';
assert.ok(fs.existsSync(path.join(root, 'complete.json')));
for (const [file, expected] of Object.entries(manifest.runtime)) assert.equal(hash(fs.readFileSync(path.join(dist, file))), expected, 'Frozen runtime mismatch: ' + file);
const { CausalWeave } = await import(path.join(dist, 'core/causalWeave.js'));
const { prepareRecall, selectRecall, validateRecallProjection } = await import(path.join(dist, 'core/recallProjection.js'));
const { createJevRecallClient } = await import(path.join(dist, 'integrations/jevRecall.js'));
globalThis.fetch = async () => { throw new Error('Evidence audit forbids network calls.'); };
const cohortManifest = load(path.join(path.dirname(cohort), 'manifest.json'));
const names = fs.readdirSync(cohort).filter(name => /^c_[a-f0-9]{16}\.json$/.test(name)).sort();
assert.equal(names.length, split === 'development' ? 28 : 196);
const rows = [];
let providerSystem;
for (const name of names) {
  const bytes = fs.readFileSync(path.join(cohort, name));
  assert.equal(hash(bytes), cohortManifest.files[split + '/' + name]);
  const participant = JSON.parse(bytes);
  const input = load(path.join(root, participant.id + '.input.json'));
  assert.equal(input.participantSha256, hash(bytes));
  const imported = importEvidence(CausalWeave, participant.sources);
  assert.deepEqual(imported.mapping, input.mapping);
  if (split === 'holdout') assert.deepEqual(imported.sourceRecords, input.sourceRecords);
  let commonPrefix;
  const arms = {};
  for (const arm of ['standard', 'lexical', 'native']) {
    const record = load(path.join(root, participant.id + '.' + arm + '.result.json'));
    if (record.status !== 'done') {
      if (record.committedState) {
        new CausalWeave(record.committedState);
        assert.equal(record.committedState.nodes.length, participant.sources.length + 1);
        assert.deepEqual(record.committedState.frontier, []);
        participant.sources.forEach((source, index) => {
          assert.equal(record.committedState.nodes[index + 1].payload, source.text);
          assert.equal(record.committedState.nodes[index + 1].id, imported.sourceRecords[index].nodeId);
        });
        commonPrefix ??= record.committedState.nodes;
        assert.deepEqual(record.committedState.nodes, commonPrefix);
      }
      arms[arm] = { returnedStateAudited: false, failedCommitPreserved: Boolean(record.committedState) };
      continue;
    }
    const result = record.result;
    new CausalWeave(result.state);
    const prefix = result.state.nodes.slice(0, participant.sources.length + 1);
    commonPrefix ??= prefix;
    assert.deepEqual(prefix, commonPrefix, 'Original source state differs between arms.');
    participant.sources.forEach((source, index) => {
      assert.equal(prefix[index + 1].payload, source.text);
      assert.equal(prefix[index + 1].resourceKey, imported.sourceRecords[index].resourceKey);
      assert.equal(prefix[index + 1].id, imported.sourceRecords[index].nodeId);
    });
    assert.equal(result.metadata.toolCalls, 0);
    assert.deepEqual(result.metadata.tools, []);
    assert.ok(result.trace.length >= 1 && result.trace.length <= 2);
    assert.equal(result.metadata.projectionMaxNodes, 48);
    assert.equal(result.metadata.projectionTargetTokens, 16_000);
    assert.equal(result.metadata.maxPromptTokens, 64_000);
    const actions = result.state.nodes.filter(node => ['answer', 'inference', 'tool_call'].includes(node.kind));
    assert.equal(actions.length, result.trace.length);
    const mainRequests = fs.readdirSync(root).filter(file => file.startsWith(participant.id + '.' + arm + '.main-') && file.endsWith('.request.json')).sort((a, b) => Number(a.match(/main-(\d+)/)[1]) - Number(b.match(/main-(\d+)/)[1]));
    assert.equal(mainRequests.length, result.trace.length);
    result.trace.forEach((step, index) => {
      const request = load(path.join(root, mainRequests[index]));
      const response = load(path.join(root, mainRequests[index].replace('.request.json', '.response.json')));
      assert.equal(request.url, 'https://api.z.ai/api/anthropic/v1/messages');
      assert.equal(request.body.model, 'glm-5.3-flash');
      assert.equal(request.body.max_tokens, 16_384);
      assert.equal(request.body.temperature, 0);
      providerSystem ??= request.body.system;
      assert.equal(request.body.system, providerSystem);
      assert.deepEqual(request.body.messages, [{ role: 'user', content: step.prompt }]);
      assert.equal(response.status, 200);
      assert.equal(response.body.model, 'glm-5.3-flash');
      assert.equal(response.body.content.filter(block => block.type === 'text').map(block => block.text).join(''), step.rawModelOutput);
      assert.ok(step.nodeIds.length <= 48 && step.contextTokens <= 64_000);
      assert.deepEqual(new Set(actions[index].parents), new Set(step.nodeIds));
      assert.ok(step.nodeIds.every(id => result.state.nodes.some(node => node.id === id)));
    });
    const recall = result.metadata.recall;
    let selected = [], visible = [];
    if (arm !== 'standard') {
      assert.ok(['ranked', 'fallback'].includes(recall.status));
      const index = prepareRecall({ version: 1, nodes: prefix, frontier: [] }, input.query);
      assert.deepEqual(index, input.candidateIndex);
      if (arm === 'native') {
        const responseFiles = fs.readdirSync(root).filter(file => file.startsWith(participant.id + '.native.jev-') && file.endsWith('.response.json'));
        const requestFiles = fs.readdirSync(root).filter(file => file.startsWith(participant.id + '.native.jev-') && file.endsWith('.request.json'));
        assert.ok(requestFiles.length <= 1 && responseFiles.length <= requestFiles.length);
        const response = responseFiles.length ? load(path.join(root, responseFiles[0])) : undefined;
        if (!response && requestFiles.length) assert.ok(fs.existsSync(path.join(root, requestFiles[0].replace('.request.json', '.error.json'))), 'Unresolved sidecar dispatch.');
        let dispatched = false;
        const client = createJevRecallClient({ apiKey: 'offline-replay-not-a-credential', fetch: async (url, options) => { dispatched = true; assert.ok(requestFiles.length); const request = load(path.join(root, requestFiles[0])); assert.equal(String(url), request.url); assert.deepEqual(JSON.parse(options.body), request.body); if (!response) throw new Error('Preserved transport failure'); return new Response(JSON.stringify(response.body), { status: response.status }); } });
        if (recall.status === 'ranked') {
          assert.equal(response?.status, 200);
          assert.deepEqual(await client.rank(input.query, index.candidates), recall.ranking);
        } else {
          assert.ok(![401, 403].includes(response?.status));
          await assert.rejects(client.rank(input.query, index.candidates));
          assert.equal(recall.ranking, undefined);
        }
        assert.equal(dispatched, requestFiles.length === 1);
      } else {
        assert.equal(recall.status, 'ranked');
        assert.equal(recall.ranking.model, 'lexical-ablation');
        assert.equal(recall.ranking.inputTokens, 0);
        assert.equal(recall.ranking.outputTokens, 0);
      }
      const projection = selectRecall(index, recall.ranking?.scores);
      validateRecallProjection({ version: 1, nodes: prefix, frontier: [] }, projection);
      selected = projection.windows.map(window => window.id);
      const last = result.trace.at(-1);
      visible = projection.windows.filter(window => last.nodeIds.includes(window.nodeId) && last.prompt.includes(`[${window.id} ${window.start}:${window.end}]\n${window.text}`)).map(window => window.id);
      assert.deepEqual(visible, recall.visibleWindowIds);
      assert.equal(recall.omittedSourceNodes, 0);
    }
    arms[arm] = { returnedStateAudited: true, ...(recall ? { recallStatus: recall.status } : {}), sourceNodes: participant.sources.length, modelCalls: result.metadata.modelCalls, selectedWindows: selected.length, fullyVisibleWindows: visible.length, extraSemanticNodes: result.state.nodes.filter(node => node.kind === 'semantic').length, promptSha256: hash(result.trace[0].prompt) };
  }
  rows.push({ id: participant.id, arms });
}
const evidenceHashes = Object.fromEntries(fs.readdirSync(root).filter(file => file.endsWith('.json')).sort().map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
console.log(JSON.stringify({ evidenceHashes, sourceCommit: manifest.commit, phase: manifest.phase, simulated: manifest.simulated ?? false, frozenRuntime: manifest.runtime, cases: rows.length, returnedStates: rows.reduce((n, row) => n + Object.values(row.arms).filter(arm => arm.returnedStateAudited).length, 0), networkCalls: 0, scope: 'Identity, immutable source copying, bounds, exact original-node action parents and actually visible full spans. Does not certify semantic truth or answer correctness.', rows }, null, 2));
