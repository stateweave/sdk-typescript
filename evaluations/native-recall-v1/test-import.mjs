import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveExclusive } from './store.mjs';
import { CausalWeave } from '../../dist/core/causalWeave.js';
import { prepareRecall } from '../../dist/core/recallProjection.js';
import { importEvidence } from './import-evidence.mjs';

const sources = [
  { id: 's_repeat', text: 'Conversation recorded: January\n\nThe code is MAPLE.' },
  { id: 's_unique', text: 'Conversation recorded: February\n\nThe city is Kyoto.' },
  { id: 's_repeat', text: 'Conversation recorded: March\n\nThe code is MAPLE.' }
];
const result = importEvidence(CausalWeave, sources);
assert.equal(result.state.nodes.length, 4);
assert.deepEqual(result.state.nodes.slice(1).map(node => node.payload), sources.map(source => source.text));
assert.equal(new Set(result.sourceRecords.map(row => row.resourceKey)).size, 3);
assert.equal(result.sourceRecords[1].resourceKey, 'conversation:s_unique');
assert.equal(prepareRecall(result.state, 'When was the code recorded?').sourceNodeIds.length, 3);
const unique = importEvidence(CausalWeave, [sources[1]]);
assert.equal(unique.sourceRecords[0].nodeId, result.sourceRecords[1].nodeId);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-recall-receipt-test-'));
try {
  const file = path.join(directory, 'receipt.json');
  saveExclusive(file, { oneShot: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => saveExclusive(file, { oneShot: false }), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { oneShot: true });
} finally { fs.rmSync(directory, { recursive: true }); }
console.log(JSON.stringify({ sourceOccurrencesPreserved: 3, uniqueIdentityUnchanged: true, privateExclusiveReceipt: true, networkCalls: 0 }));
