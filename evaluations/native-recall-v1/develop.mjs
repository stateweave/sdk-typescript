import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Agent } from '../../dist/agent/agent.js';
import { CausalWeave } from '../../dist/core/causalWeave.js';
import { prepareRecall, selectRecall } from '../../dist/core/recallProjection.js';
import { createJevRecallClient } from '../../dist/integrations/jevRecall.js';
import { AnthropicModel } from '../../dist/llm/anthropicModel.js';

const phase = process.env.PROBE_PHASE;
const output = process.env.PROBE_OUTPUT;
const cohort = process.env.PROBE_COHORT;
const commit = process.env.PROBE_COMMIT;
if (!['calibration', 'ranking'].includes(phase) || !output || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Explicit development phase, output and frozen commit required.');
if (!process.env.ANTHROPIC_API_KEY || !process.env.TYPESAFE_API_KEY) throw new Error('Configured provider credentials required.');
if (fs.existsSync(output)) throw new Error('Existing attempt: no automatic replay or overwrite.');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (name, value) => { const file = path.join(output, name); const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const runtime = Object.fromEntries(['agent/agent.js', 'core/causalWeave.js', 'core/recallProjection.js', 'core/recallTypes.js', 'integrations/jevRecall.js', 'llm/anthropicModel.js'].map(file => [file, hash(fs.readFileSync(new URL('../../dist/' + file, import.meta.url)))]));
const limits = phase === 'calibration' ? { main: 6, jev: 10 } : { main: 0, jev: 84 };
const counts = { main: 0, jev: 0 };
const transport = globalThis.fetch;
let owner = 'calibration';
let lastMainStart = 0;
const secrets = [process.env.ANTHROPIC_API_KEY, process.env.TYPESAFE_API_KEY].flatMap(key => [key, Buffer.from(key).toString('base64')]);
const redact = value => {
  let text = JSON.stringify(value);
  for (const secret of secrets) if (secret.length >= 16) text = text.split(secret).join('[REDACTED_CREDENTIAL_ECHO]');
  return JSON.parse(text);
};
globalThis.fetch = async (input, options) => {
  const url = String(input);
  const provider = url === 'https://api.typesafe.ai/v1/systemone' ? 'jev' : url === 'https://api.z.ai/api/anthropic/v1/messages' ? 'main' : undefined;
  if (!provider) throw new Error('Development transport denied an unexpected URL.');
  if (counts[provider] >= limits[provider]) throw new Error('Development provider budget exhausted.');
  if (provider === 'main') {
    const pause = Math.max(0, lastMainStart + 15_000 - Date.now());
    if (pause) await new Promise(resolve => setTimeout(resolve, pause));
    lastMainStart = Date.now();
  }
  const id = `${owner}.${provider}-${String(++counts[provider]).padStart(3, '0')}`;
  const started = Date.now();
  save(id + '.request.json', { url, body: JSON.parse(options.body), startedAt: new Date(started).toISOString() });
  try {
    const response = await transport(input, { ...options, redirect: 'error' });
    const parsed = await response.clone().json().catch(() => ({ nonJsonBody: true }));
    const copy = provider === 'main' ? Object.fromEntries(['id', 'type', 'role', 'model', 'stop_reason', 'stop_sequence', 'usage', 'error', 'nonJsonBody'].filter(key => key in parsed).map(key => [key, parsed[key]])) : parsed;
    if (provider === 'main' && Array.isArray(parsed.content)) {
      copy.content = parsed.content.filter(block => block.type === 'text').map(block => ({ type: 'text', text: block.text }));
      copy.nonTextBlocksOmitted = parsed.content.filter(block => block.type !== 'text').length;
    }
    save(id + '.response.json', redact({ status: response.status, elapsedMs: Date.now() - started, body: copy }));
    return response;
  } catch (error) {
    save(id + '.error.json', { errorClass: error?.name ?? 'Error', elapsedMs: Date.now() - started, usageUnknown: true });
    throw error;
  }
};

function sourceState(sources) {
  const weave = new CausalWeave();
  const root = weave.append({ kind: 'system', payload: 'Historical source evidence. Original conversation dates appear in the source text.', advance: false });
  const mapping = {};
  for (const source of sources) {
    const node = weave.append({ kind: 'resource', resourceKey: 'conversation:' + source.id, payload: source.text, parents: [root.id], advance: false });
    mapping[source.id] = node.id;
  }
  return { state: weave.snapshot(), mapping };
}
const systemPrompt = 'Answer the current question using the supplied historical conversation evidence. Distinguish assistant suggestions and future plans from completed user actions. If necessary evidence is missing, say so. Answer concisely and specifically.';
const model = () => new AnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: 'https://api.z.ai/api/anthropic', version: '2023-06-01', model: 'glm-5.3-flash', maxTokens: 16_384, temperature: 0, timeoutMs: 180_000 });
save('manifest.json', { phase, commit, runtime, startedAt: new Date().toISOString(), model: 'glm-5.3-flash', jevModel: 'jev-1.13.0', mainMaxTokens: 16_384, mainMinIntervalMs: 15_000, caseWorkers: 1, limits, providerRequests: 'No retries; every dispatch preserved; no hidden thinking or headers stored.' });

try {
if (phase === 'calibration') {
  const sources = Array.from({ length: 24 }, (_, i) => ({ id: 'source-' + i, text: `Conversation recorded: 2024/01/${String(i + 1).padStart(2, '0')}\n` + ('Ordinary unrelated garden background. '.repeat(180)) + (i === 6 ? '\nThe approved Harbor launch city is Kyoto and the confirmation code is MAPLE-417.\n' : '\nThis conversation covers planting and soil.\n') + 'Additional garden observations. '.repeat(80) }));
  const { state } = sourceState(sources);
  const query = 'What is the approved Harbor launch city and its confirmation code?';
  const index = prepareRecall(state, query);
  for (const design of ['indexed', 'direct', 'graded']) {
    owner = 'calibration-' + design;
    const ranking = await createJevRecallClient({}, design).rank(query, index.candidates);
    save(owner + '.ranking.json', { design, candidateIds: index.candidates.map(row => row.id), ranking, selected: selectRecall(index, ranking.scores) });
  }
  for (let i = 0; i < 3; i++) {
    owner = 'calibration-agent-' + i;
    const agent = new Agent({ state, model: model(), tools: [], maxIterations: 2, systemPrompt, enforceCompletionEvidence: false });
    const result = await agent.run(query, { signal: AbortSignal.timeout(400_000) });
    save(owner + '.result.json', result);
    if (!result.finalAnswer.includes('Kyoto') || !result.finalAnswer.includes('MAPLE-417') || result.metadata.recall?.status !== 'ranked') throw new Error('Native calibration did not produce the expected grounded answer and successful recall.');
    console.log(JSON.stringify({ owner, done: true, calls: result.metadata.modelCalls, recall: result.metadata.recall.status }));
  }
} else {
  if (!cohort || path.basename(cohort) !== 'development') throw new Error('Development ranking cannot open a held-out cohort.');
  const cohortManifestBytes = fs.readFileSync(path.join(path.dirname(cohort), 'manifest.json'));
  const cohortManifest = JSON.parse(cohortManifestBytes);
  save('cohort.json', { manifestSha256: hash(cohortManifestBytes), split: 'development', files: Object.fromEntries(Object.entries(cohortManifest.files).filter(([name]) => name.startsWith('development/'))) });
  const files = fs.readdirSync(cohort).filter(name => /^c_[a-f0-9]{16}\.json$/.test(name)).sort();
  if (files.length !== 28) throw new Error('Expected exactly 28 development cases.');
  for (const [caseIndex, file] of files.entries()) {
    const bytes = fs.readFileSync(path.join(cohort, file));
    if (hash(bytes) !== cohortManifest.files['development/' + file]) throw new Error('Development participant hash mismatch.');
    const row = JSON.parse(bytes);
    if (Object.keys(row).sort().join(',') !== 'date,id,question,sources' || !/^c_[a-f0-9]{16}$/.test(row.id) || row.sources.some(source => Object.keys(source).sort().join(',') !== 'id,text' || !/^s_[a-f0-9]{20}$/.test(source.id))) throw new Error('Participant schema or opaque identity mismatch.');
    owner = row.id;
    const { state, mapping } = sourceState(row.sources);
    const query = `As of ${row.date}, ${row.question}`;
    const index = prepareRecall(state, query);
    save(row.id + '.input.json', { participantSha256: hash(bytes), query, mapping, candidateIndex: index, lexicalSelection: selectRecall(index) });
    const designs = ['indexed', 'direct', 'graded'];
    for (let offset = 0; offset < designs.length; offset++) {
      const design = designs[(caseIndex + offset) % designs.length];
      owner = row.id + '.' + design;
      save(owner + '.start.json', { design, startedAt: new Date().toISOString() });
      const started = Date.now();
      try {
        const ranking = await createJevRecallClient({}, design).rank(query, index.candidates);
        save(owner + '.result.json', { status: 'done', design, elapsedMs: Date.now() - started, ranking, selection: selectRecall(index, ranking.scores) });
      } catch (error) { save(owner + '.result.json', { status: 'failed', design, elapsedMs: Date.now() - started, errorClass: error?.name ?? 'Error', usageUnknown: true }); }
    }
    console.log(JSON.stringify({ case: row.id, completed: caseIndex + 1, total: files.length }));
  }
}
save('complete.json', { completedAt: new Date().toISOString(), counts });
console.log(JSON.stringify({ complete: true, counts }));
} catch (error) {
  save('failed.json', redact({ failedAt: new Date().toISOString(), errorClass: error?.name ?? 'Error', message: error?.message ?? '', counts }));
  console.error(JSON.stringify({ failed: true, errorClass: error?.name ?? 'Error', counts }));
  process.exitCode = 1;
}
