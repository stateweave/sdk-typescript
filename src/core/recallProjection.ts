import { createHash } from 'node:crypto';
import type { CausalWeaveNode, CausalWeaveSnapshot } from './causalTypes.js';
import { isWellFormedUnicode, splitsSurrogatePair, utf16Prefix } from './unicodeText.js';

import type { RecallWindow, RecallIndex, RecallProjection, RecallRanking } from './recallTypes.js';
export type * from './recallTypes.js';

const WINDOW_STRIDE = 1_200;
const WINDOW_SPAN = 1_600;
const PREFIX_CHARS = 240;
const SOURCE_CHAR_BUDGET = 2_000_000;
const MAX_SELECTED = 12;
const RECALL_KINDS = new Set(['semantic', 'resource', 'goal', 'answer', 'tool_result']);
const EXCERPT_NOTICE = '[Exact source excerpts; omitted text is not evidence of absence. Offsets are UTF-16 code units.]\n';

const stop = new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should that the their them then there these they this to was were what when where which who why will with would you your'.split(' '));
const terms = (text: string) => (text.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 1 && !stop.has(word));
const windowId = (nodeId: string, start: number, end: number) => 'rw_' + createHash('sha256').update(`${nodeId}:${start}:${end}`).digest('hex').slice(0, 20);
const overlaps = (a: RecallWindow, b: RecallWindow) => Math.max(a.start, b.start) < Math.min(a.end, b.end);

function recallSourceText(node: CausalWeaveNode): string {
  return typeof node.payload === 'string' ? node.payload : canonical(node.payload);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

export function prepareRecall(snapshot: CausalWeaveSnapshot, query: string, candidateLimit = 64): RecallIndex {
  assertRecallBounds(query, candidateLimit);
  const sources = recallSources(snapshot);
  const windows: RecallWindow[] = [];
  const sourceNodeIds: string[] = [];
  let characters = 0;
  for (const node of [...sources].reverse()) {
    const text = recallSourceText(node);
    if (characters + text.length > SOURCE_CHAR_BUDGET) continue;
    if (!isWellFormedUnicode(text)) throw new Error('Recall source contains invalid Unicode; original evidence was not modified.');
    characters += text.length;
    sourceNodeIds.push(node.id);
    windows.push(...sliceWindows(node, text));
  }
  scoreWindows(windows, new Set(terms(query)));
  windows.sort((a, b) => b.lexicalScore - a.lexicalScore || a.id.localeCompare(b.id));
  return { sourceNodeIds, candidates: windows.slice(0, candidateLimit), windows: windows.length, omittedSourceNodes: sources.length - sourceNodeIds.length };
}

function assertRecallBounds(query: string, candidateLimit: number): void {
  const validLimit = Number.isInteger(candidateLimit) && candidateLimit >= 1 && candidateLimit <= 96;
  if (!validLimit || !query || query.length > 8_000) throw new Error('Invalid native recall bounds.');
  if (!isWellFormedUnicode(query)) throw new Error('Recall query contains invalid Unicode.');
}

/** Current resource heads plus goals, answers, semantic notes and tool results; artifacts and prior recall output are excluded. */
function recallSources(snapshot: CausalWeaveSnapshot): CausalWeaveNode[] {
  const heads = new Map<string, string>();
  for (const node of snapshot.nodes) if (node.resourceKey) heads.set(node.resourceKey, node.id);
  return snapshot.nodes.filter(node => {
    if (node.resourceKey && heads.get(node.resourceKey) !== node.id) return false;
    if (!RECALL_KINDS.has(node.kind)) return false;
    const payload = node.payload as Record<string, unknown> | null;
    if (node.kind === 'semantic' && payload?.type === 'artifact') return false;
    return !(node.kind === 'tool_result' && payload?.tool === 'recall');
  });
}

/** Overlapping windows over one source, never splitting a surrogate pair. */
function sliceWindows(node: CausalWeaveNode, text: string): RecallWindow[] {
  const windows: RecallWindow[] = [];
  const sourcePrefix = utf16Prefix(text, PREFIX_CHARS);
  for (let offset = 0; offset < text.length; offset += WINDOW_STRIDE) {
    const start = splitsSurrogatePair(text, offset) ? offset + 1 : offset;
    const boundary = Math.min(text.length, offset + WINDOW_SPAN);
    const end = splitsSurrogatePair(text, boundary) ? boundary - 1 : boundary;
    windows.push({ id: windowId(node.id, start, end), nodeId: node.id, kind: node.kind, start, end, text: text.slice(start, end), sourcePrefix, lexicalScore: 0 });
    if (end === text.length) break;
  }
  return windows;
}

/** BM25 (k1 = 1.2, b = 0.75) over the windows, written into `lexicalScore`. */
function scoreWindows(windows: RecallWindow[], queryTerms: Set<string>): void {
  const tokens = windows.map(window => terms(window.text));
  const averageLength = Math.max(1, tokens.reduce((sum, row) => sum + row.length, 0) / Math.max(1, tokens.length));
  const frequencies = new Map<string, number>();
  for (const row of tokens) for (const term of new Set(row)) if (queryTerms.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  windows.forEach((window, i) => {
    const counts = new Map<string, number>();
    for (const term of tokens[i]!) counts.set(term, (counts.get(term) ?? 0) + 1);
    const lengthNorm = 1.2 * (.25 + .75 * tokens[i]!.length / averageLength);
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0, df = frequencies.get(term) ?? 0;
      window.lexicalScore += Math.log(1 + (windows.length - df + .5) / (df + .5)) * tf * 2.2 / (tf + lengthNorm);
    }
  });
}

export function selectRecall(index: RecallIndex, scores?: RecallRanking['scores'], limit = MAX_SELECTED, lexicalReserve = 0): RecallProjection {
  const validBudget = Number.isInteger(limit) && limit >= 1 && limit <= MAX_SELECTED && Number.isInteger(lexicalReserve) && lexicalReserve >= 0 && lexicalReserve <= limit;
  if (!validBudget) throw new Error('Invalid recall selection budget.');
  if (scores && !validRecallScores(index, scores)) throw new Error('Invalid recall scores.');
  const relevance = new Map(scores?.map(row => [row.id, row.relevance]));
  const ranked = scores ? [...index.candidates].sort((a, b) => relevance.get(b.id)! - relevance.get(a.id)! || b.lexicalScore - a.lexicalScore || a.id.localeCompare(b.id)) : index.candidates;
  const selected: RecallWindow[] = [];
  const add = (window: RecallWindow) => {
    const sameNode = selected.filter(other => other.nodeId === window.nodeId);
    if (selected.length < limit && sameNode.length < 2 && !sameNode.some(other => overlaps(other, window))) selected.push(window);
  };
  for (const window of index.candidates.slice(0, lexicalReserve)) add(window);
  for (const window of ranked) add(window);
  return { sourceNodeIds: [...index.sourceNodeIds], windows: selected };
}

function validRecallScores(index: RecallIndex, scores: RecallRanking['scores']): boolean {
  const candidateIds = new Set(index.candidates.map(candidate => candidate.id));
  const validRow = (row: RecallRanking['scores'][number]) => candidateIds.has(row.id) && Number.isFinite(row.relevance) && row.relevance >= 0 && row.relevance <= 1;
  return scores.length === index.candidates.length && new Set(scores.map(row => row.id)).size === scores.length && scores.every(validRow);
}

export function validateRecallProjection(snapshot: CausalWeaveSnapshot, projection: RecallProjection): Map<string, string> {
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  assertProjectionIdentities(projection, nodes);
  const grouped = new Map<string, RecallWindow[]>();
  for (const window of projection.windows) {
    const node = nodes.get(window.nodeId);
    if (!node || !projection.sourceNodeIds.includes(node.id) || !copiesExactSpan(window, node)) throw new Error('Recall projection must copy exact source spans.');
    if (window.id !== windowId(node.id, window.start, window.end)) throw new Error('Invalid recall window identity.');
    const rows = grouped.get(node.id) ?? [];
    if (rows.length >= 2 || rows.some(other => overlaps(other, window))) throw new Error('Invalid recall source packing.');
    rows.push(window);
    grouped.set(node.id, rows);
  }
  return new Map([...grouped].map(([id, windows]) => [id, renderExcerpts(windows)]));
}

function assertProjectionIdentities(projection: RecallProjection, nodes: Map<string, CausalWeaveNode>): void {
  const uniqueSources = new Set(projection.sourceNodeIds).size === projection.sourceNodeIds.length;
  const uniqueWindows = new Set(projection.windows.map(window => window.id)).size === projection.windows.length;
  if (!uniqueSources || projection.sourceNodeIds.some(id => !nodes.has(id)) || projection.windows.length > MAX_SELECTED || !uniqueWindows) throw new Error('Invalid recall projection identities.');
}

function copiesExactSpan(window: RecallWindow, node: CausalWeaveNode): boolean {
  const text = recallSourceText(node);
  const { start, end } = window;
  const validRange = window.kind === node.kind && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length && end - start <= WINDOW_SPAN;
  if (!validRange || splitsSurrogatePair(text, start) || splitsSurrogatePair(text, end)) return false;
  return isWellFormedUnicode(window.text) && text.slice(start, end) === window.text && utf16Prefix(text, PREFIX_CHARS) === window.sourcePrefix && isWellFormedUnicode(window.sourcePrefix);
}

function renderExcerpts(windows: RecallWindow[]): string {
  const prefix = windows.every(window => window.start > 0) ? `[Original source prefix, 0:${windows[0]!.sourcePrefix.length}]\n` + windows[0]!.sourcePrefix + '\n' : '';
  return EXCERPT_NOTICE + prefix + windows.sort((a, b) => a.start - b.start).map(window => `[${window.id} ${window.start}:${window.end}]\n${window.text}`).join('\n');
}
