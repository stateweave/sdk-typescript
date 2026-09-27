import { createHash } from 'node:crypto';
import type { CausalWeaveNode, CausalWeaveSnapshot } from './causalTypes.js';

import type { RecallWindow, RecallIndex, RecallProjection, RecallRanking } from './recallTypes.js';
export type * from './recallTypes.js';

const stop = new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should that the their them then there these they this to was were what when where which who why will with would you your'.split(' '));
const terms = (text: string) => (text.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 1 && !stop.has(word));
export function recallSourceText(node: CausalWeaveNode): string {
  return typeof node.payload === 'string' ? node.payload : canonical(node.payload);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

export function prepareRecall(snapshot: CausalWeaveSnapshot, query: string, candidateLimit = 64): RecallIndex {
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 96 || !query || query.length > 8_000) throw new Error('Invalid native recall bounds.');
  const heads = new Map<string, string>();
  for (const node of snapshot.nodes) if (node.resourceKey) heads.set(node.resourceKey, node.id);
  const sources = snapshot.nodes.filter(node => {
    if (node.resourceKey && heads.get(node.resourceKey) !== node.id) return false;
    if (!['semantic', 'resource', 'goal', 'answer', 'tool_result'].includes(node.kind)) return false;
    const payload = node.payload as Record<string, unknown> | null;
    if (node.kind === 'semantic' && payload?.type === 'artifact') return false;
    if (node.kind === 'tool_result' && payload?.tool === 'recall') return false;
    return true;
  });
  const windows: RecallWindow[] = [];
  const sourceNodeIds: string[] = [];
  let characters = 0;
  for (const node of [...sources].reverse()) {
    const text = recallSourceText(node);
    if (characters + text.length > 2_000_000) continue;
    characters += text.length;
    sourceNodeIds.push(node.id);
    for (let start = 0; start < text.length; start += 1_200) {
      const end = Math.min(text.length, start + 1_600);
      const id = 'rw_' + createHash('sha256').update(`${node.id}:${start}:${end}`).digest('hex').slice(0, 20);
      windows.push({ id, nodeId: node.id, kind: node.kind, start, end, text: text.slice(start, end), sourcePrefix: text.slice(0, 240), lexicalScore: 0 });
      if (end === text.length) break;
    }
  }
  const queryTerms = new Set(terms(query));
  const tokens = windows.map(window => terms(window.text));
  const averageLength = tokens.reduce((sum, row) => sum + row.length, 0) / Math.max(1, tokens.length);
  const frequencies = new Map<string, number>();
  for (const row of tokens) for (const term of new Set(row)) if (queryTerms.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  for (let i = 0; i < windows.length; i++) {
    const counts = new Map<string, number>();
    for (const term of tokens[i]!) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0, df = frequencies.get(term) ?? 0;
      const idf = Math.log(1 + (windows.length - df + .5) / (df + .5));
      windows[i]!.lexicalScore += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * tokens[i]!.length / Math.max(1, averageLength)));
    }
  }
  windows.sort((a, b) => b.lexicalScore - a.lexicalScore || a.id.localeCompare(b.id));
  return { sourceNodeIds, candidates: windows.slice(0, candidateLimit), windows: windows.length, omittedSourceNodes: sources.length - sourceNodeIds.length };
}

export function selectRecall(index: RecallIndex, scores?: RecallRanking['scores'], limit = 12, lexicalReserve = 0): RecallProjection {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12 || !Number.isInteger(lexicalReserve) || lexicalReserve < 0 || lexicalReserve > limit) throw new Error('Invalid recall selection budget.');
  if (scores && (scores.length !== index.candidates.length || new Set(scores.map(row => row.id)).size !== scores.length || scores.some(row => !index.candidates.some(candidate => candidate.id === row.id) || !Number.isFinite(row.relevance) || row.relevance < 0 || row.relevance > 1))) throw new Error('Invalid recall scores.');
  const relevance = new Map(scores?.map(row => [row.id, row.relevance]));
  const ranked = scores ? [...index.candidates].sort((a, b) => relevance.get(b.id)! - relevance.get(a.id)! || b.lexicalScore - a.lexicalScore || a.id.localeCompare(b.id)) : index.candidates;
  const selected: RecallWindow[] = [];
  const add = (window: RecallWindow) => {
    if (selected.length >= limit || selected.filter(other => other.nodeId === window.nodeId).length >= 2 || selected.some(other => other.nodeId === window.nodeId && Math.max(other.start, window.start) < Math.min(other.end, window.end))) return;
    selected.push(window);
  };
  for (const window of index.candidates.slice(0, lexicalReserve)) add(window);
  for (const window of ranked) add(window);
  return { sourceNodeIds: [...index.sourceNodeIds], windows: selected };
}

export function validateRecallProjection(snapshot: CausalWeaveSnapshot, projection: RecallProjection): Map<string, string> {
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  if (new Set(projection.sourceNodeIds).size !== projection.sourceNodeIds.length || projection.sourceNodeIds.some(id => !nodes.has(id)) || projection.windows.length > 12 || new Set(projection.windows.map(window => window.id)).size !== projection.windows.length) throw new Error('Invalid recall projection identities.');
  const grouped = new Map<string, RecallWindow[]>();
  for (const window of projection.windows) {
    const node = nodes.get(window.nodeId);
    const text = node ? recallSourceText(node) : '';
    if (!node || !projection.sourceNodeIds.includes(node.id) || window.kind !== node.kind || !Number.isInteger(window.start) || !Number.isInteger(window.end) || window.start < 0 || window.end <= window.start || window.end > text.length || window.end - window.start > 1_600 || text.slice(window.start, window.end) !== window.text || text.slice(0, 240) !== window.sourcePrefix) throw new Error('Recall projection must copy exact source spans.');
    const expectedId = 'rw_' + createHash('sha256').update(`${node.id}:${window.start}:${window.end}`).digest('hex').slice(0, 20);
    if (window.id !== expectedId) throw new Error('Invalid recall window identity.');
    const rows = grouped.get(node.id) ?? [];
    if (rows.length >= 2 || rows.some(other => Math.max(other.start, window.start) < Math.min(other.end, window.end))) throw new Error('Invalid recall source packing.');
    rows.push(window);
    grouped.set(node.id, rows);
  }
  return new Map([...grouped].map(([id, windows]) => [id, '[Exact source excerpts; omitted text is not evidence of absence. Offsets are UTF-16 code units.]\n' + (windows.every(window => window.start > 0) ? `[Original source prefix, 0:${windows[0]!.sourcePrefix.length}]\n` + windows[0]!.sourcePrefix + '\n' : '') + windows.sort((a, b) => a.start - b.start).map(window => `[${window.id} ${window.start}:${window.end}]\n${window.text}`).join('\n')]));
}
