import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Agent } from '../../dist/agent/agent.js';
import { CausalWeave } from '../../dist/core/causalWeave.js';
import { prepareRecall, selectRecall } from '../../dist/core/recallProjection.js';
import { AnthropicModel } from '../../dist/llm/anthropicModel.js';
import { importEvidence } from './import-evidence.mjs';
import { saveExclusive as exclusive, syncDirectory } from './store.mjs';

assert.ok(process.argv.slice(2).every(argument => argument === '--offline'), 'Unknown execution flag.');
const offline = process.argv.includes('--offline');
assert.ok(offline || process.env.NATIVE_RECALL_CONFIRM === 'RUN_FROZEN_COHORT_ONCE', 'Explicit one-shot execution acknowledgment required.');
const output = process.env.PROBE_OUTPUT;
const cohort = process.env.PROBE_COHORT;
const baselineRoot = process.env.BASELINE_DIST;
const commit = process.env.PROBE_COMMIT;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const freeze = load(new URL('./CONFIRMATORY_FREEZE.json', import.meta.url));
assert.equal(commit, freeze.commit);
assert.equal(process.version, freeze.nodeVersion);
assert.equal(createRequire(import.meta.url)('zod/package.json').version, freeze.zodVersion);
assert.ok(offline || freeze.status === 'frozen', 'An engineering draft cannot make held-out provider calls.');
assert.ok(cohort && path.basename(cohort) === 'holdout' && baselineRoot);
assert.ok(output && (offline ? /^\/tmp\/native-recall-offline-[a-z0-9-]+$/.test(output) : output === `/data/native-recall-v1-${commit.slice(0, 7)}-live`));
assert.ok(process.env.ANTHROPIC_API_KEY && process.env.TYPESAFE_API_KEY, 'Provider credentials must already be configured.');
assert.ok(!fs.existsSync(output), 'Existing attempt: no automatic replay or overwrite.');
for (const [file, expected] of Object.entries(freeze.runtime)) assert.equal(hash(fs.readFileSync(new URL('../../dist/' + file, import.meta.url))), expected, file);
for (const [file, expected] of Object.entries(freeze.baselineRuntime)) assert.equal(hash(fs.readFileSync(path.join(baselineRoot, file))), expected, file);
for (const [file, expected] of Object.entries(freeze.files)) assert.equal(hash(fs.readFileSync(new URL(file, import.meta.url))), expected, file);
const manifestBytes = fs.readFileSync(path.join(path.dirname(cohort), 'manifest.json'));
assert.equal(hash(manifestBytes), freeze.cohortManifestSha256);
const cohortManifest = JSON.parse(manifestBytes);
const files = fs.readdirSync(cohort).filter(name => /^c_[a-f0-9]{16}\.json$/.test(name)).sort();
assert.equal(files.length, 196);
for (const file of files) {
  const bytes = fs.readFileSync(path.join(cohort, file));
  assert.equal(hash(bytes), cohortManifest.files['holdout/' + file]);
  const row = JSON.parse(bytes);
  assert.equal(row.id + '.json', file);
  assert.equal(Object.keys(row).sort().join(','), 'date,id,question,sources');
  assert.ok(typeof row.date === 'string' && typeof row.question === 'string' && row.question.trim() && `As of ${row.date}, ${row.question}`.length <= 8_000);
  assert.ok(Array.isArray(row.sources) && row.sources.length);
  assert.ok(row.sources.every(source => Object.keys(source).sort().join(',') === 'id,text' && /^s_[a-f0-9]{20}$/.test(source.id) && typeof source.text === 'string'));
}
if (!offline) exclusive('/data/native-recall-v1-confirmation-started.json', { commit, output, freezeSha256: hash(JSON.stringify(freeze)), startedAt: new Date().toISOString(), rule: 'One live cohort only. Never delete this receipt to replay.' });
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
syncDirectory(path.dirname(output));
const save = (name, value) => exclusive(path.join(output, name), value);
save('claim.json', offline ? { simulated: true, liveClaimed: false } : load('/data/native-recall-v1-confirmation-started.json'));
const limits = { main: 1176, jev: 196 };
const counts = { main: 0, jev: 0 };
let owner = '', caseIndex = 0, lastMainStart = 0, fatalBoundary = false;
const secrets = [process.env.ANTHROPIC_API_KEY, process.env.TYPESAFE_API_KEY].flatMap(key => [key, Buffer.from(key).toString('base64')]);
const redact = value => {
  let text = JSON.stringify(value);
  for (const secret of secrets) if (secret.length >= 16) text = text.split(secret).join('[REDACTED_CREDENTIAL_ECHO]');
  return JSON.parse(text);
};
async function mockTransport(url, options) {
  const body = JSON.parse(options.body);
  if (url.includes('typesafe.ai')) {
    if (caseIndex === 1 || caseIndex === 3) return new Response('{}', { status: 520 });
    const keys = Object.keys(body.questions);
    return Response.json({ model: body.model, answers: Object.fromEntries(keys.map((key, index) => [key, { type: 'noul', noul: 1 - index / keys.length }])), usage: { input_tokens: 100, output_tokens: 3 }, simulated: true });
  }
  if ((caseIndex === 2 && owner.endsWith('.standard')) || (caseIndex === 3 && owner.endsWith('.native'))) return Response.json({ error: { code: '1302', message: 'Offline injected rate limit.' }, simulated: true }, { status: 429 });
  return Response.json({ id: 'offline', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'FINAL: OFFLINE HARNESS CHECK ONLY' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 3 }, simulated: true });
}
const transport = offline ? mockTransport : globalThis.fetch;
async function boundedCopy(response, signal) {
  const reader = response.body.getReader();
  const parts = [];
  let size = 0, onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('Provider response exceeds evidence-capture bound.');
      parts.push(value);
    }
    return Buffer.concat(parts).toString('utf8');
  } finally {
    signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
globalThis.fetch = async (input, options) => {
  const url = String(input);
  const provider = url === 'https://api.typesafe.ai/v1/systemone' ? 'jev' : url === 'https://api.z.ai/api/anthropic/v1/messages' ? 'main' : undefined;
  assert.ok(provider, 'Unexpected provider URL.');
  assert.ok(counts[provider] < limits[provider], 'Provider budget exhausted.');
  options.signal.throwIfAborted();
  if (provider === 'main' && !offline) {
    const pause = Math.max(0, lastMainStart + 15_000 - Date.now());
    if (pause) await new Promise(resolve => setTimeout(resolve, pause));
    options.signal.throwIfAborted();
    lastMainStart = Date.now();
  }
  const id = `${owner}.${provider}-${String(++counts[provider]).padStart(3, '0')}`;
  const started = Date.now();
  save(id + '.request.json', redact({ url, body: JSON.parse(options.body), startedAt: new Date(started).toISOString(), simulated: offline }));
  let response;
  try {
    response = await transport(input, { ...options, redirect: 'error' });
    const raw = await boundedCopy(response.clone(), options.signal);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { nonJsonBody: true, bodySha256: hash(raw) }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = { nonObjectBody: true, bodySha256: hash(raw) };
    const copy = provider === 'main' ? Object.fromEntries(['id', 'type', 'role', 'model', 'stop_reason', 'stop_sequence', 'usage', 'error', 'nonJsonBody', 'nonObjectBody', 'bodySha256', 'simulated'].filter(key => key in parsed).map(key => [key, parsed[key]])) : parsed;
    if (provider === 'main' && Array.isArray(parsed.content)) {
      copy.content = parsed.content.filter(block => block?.type === 'text').map(block => ({ type: 'text', text: block.text }));
      copy.nonTextBlocksOmitted = parsed.content.filter(block => block?.type !== 'text').length;
    }
    save(id + '.response.json', redact({ status: response.status, elapsedMs: Date.now() - started, body: copy }));
    if ([401, 403].includes(response.status) || (provider === 'main' && response.ok && parsed.model !== 'glm-5.3-flash')) fatalBoundary = true;
    if (provider === 'main' && response.ok && parsed.model !== 'glm-5.3-flash') throw new Error('Frozen main-model identity mismatch.');
    return response;
  } catch (error) {
    void response?.body?.cancel().catch(() => undefined);
    save(id + '.error.json', { errorClass: error?.name ?? 'Error', observedHttpStatus: response?.status ?? null, elapsedMs: Date.now() - started, usageUnknown: true });
    throw error;
  }
};
const { Agent: BaselineAgent } = await import(path.join(baselineRoot, 'agent/agent.js'));
const systemPrompt = 'Answer the current question using the supplied historical conversation evidence. Distinguish assistant suggestions and future plans from completed user actions. If necessary evidence is missing, say so. Answer concisely and specifically.';
const model = () => new AnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: 'https://api.z.ai/api/anthropic', version: '2023-06-01', model: 'glm-5.3-flash', maxTokens: 16_384, temperature: 0, timeoutMs: 180_000 });
save('manifest.json', { phase: offline ? 'offline-harness' : 'confirmatory', commit, runtime: freeze.runtime, freeze, nodeVersion: process.version, startedAt: new Date().toISOString(), model: 'glm-5.3-flash', jevModel: 'jev-1.13.0', mainMaxTokens: 16_384, mainMinIntervalMs: offline ? 0 : 15_000, caseWorkers: 1, limits, providerRequests: 'No transport retries. Every start is preserved. Hidden thinking and headers are not persisted.', simulated: offline });
save('cohort.json', { manifestSha256: hash(manifestBytes), split: 'holdout', files: Object.fromEntries(Object.entries(cohortManifest.files).filter(([name]) => name.startsWith('holdout/'))) });
save('baseline.json', { baseCommit: '762c773185e6f7c33358d2c7195f53c39e20aed5', sharedChange: 'Identical terminal-FINAL no-tool parser repair in every arm.', runtime: freeze.baselineRuntime });
try {
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(cohort, file));
    const row = JSON.parse(bytes);
    const { state, mapping, sourceRecords } = importEvidence(CausalWeave, row.sources);
    const query = `As of ${row.date}, ${row.question}`;
    const index = prepareRecall(state, query);
    save(row.id + '.input.json', { participantSha256: hash(bytes), query, mapping, sourceRecords, candidateIndex: index, lexicalSelection: selectRecall(index) });
    const arms = ['standard', 'lexical', 'native'];
    for (let offset = 0; offset < arms.length; offset++) {
      const arm = arms[(caseIndex + offset) % arms.length];
      owner = row.id + '.' + arm;
      save(owner + '.start.json', { arm, startedAt: new Date().toISOString() });
      const started = Date.now();
      let agent, recall;
      try {
        const Constructor = arm === 'standard' ? BaselineAgent : Agent;
        agent = new Constructor({ state, model: model(), tools: [], maxIterations: 2, systemPrompt, enforceCompletionEvidence: false, projectionMaxNodes: 48, projectionTargetTokens: 16_000, maxPromptTokens: 64_000, contextMode: 'causal' });
        if (arm === 'lexical') Object.defineProperty(agent, 'jev', { value: { rank: async (_query, candidates) => ({ model: 'lexical-ablation', scores: candidates.map((candidate, index) => ({ id: candidate.id, relevance: 1 - index / candidates.length })), inputTokens: 0, outputTokens: 0 }) } });
        const result = await agent.run(query, { signal: AbortSignal.timeout(400_000), onProgress: progress => { if (progress.recall) recall = structuredClone(progress.recall); } });
        save(owner + '.result.json', { status: 'done', arm, elapsedMs: Date.now() - started, evaluationOnlyScorerOverride: arm === 'lexical', result });
      } catch (error) { save(owner + '.result.json', { status: 'failed', arm, elapsedMs: Date.now() - started, errorClass: error?.name ?? 'Error', usageMayBeIncomplete: true, recall, ...(agent ? { committedState: agent.getState() } : {}), ...(error?.state ? { diagnostic: { state: error.state, trace: error.trace, metrics: error.metrics } } : {}) }); }
      if (fatalBoundary) throw new Error('Frozen provider identity or credential boundary failed; no replay.');
      console.log(JSON.stringify({ case: row.id, arm, completedCaseIndex: caseIndex + 1, totalCases: files.length, simulated: offline }));
    }
    caseIndex++;
  }
  save('complete.json', { completedAt: new Date().toISOString(), counts, simulated: offline });
  console.log(JSON.stringify({ complete: true, counts, simulated: offline }));
} catch (error) {
  save('failed.json', redact({ failedAt: new Date().toISOString(), errorClass: error?.name ?? 'Error', message: error?.message ?? '', counts }));
  process.exitCode = 1;
}
