// SWX/1 compatibility parser. New prompts teach SW2; this keeps stored traces and older clients readable.

import { edgeTypes, type EdgeType, type GraphOp, type NodeType } from "./types.js";
import { duplicateValues, isAttrToken, parsePrimitive, splitAttr, splitBlocks, statusValue, tokenize, unique, unquote, withoutUndefined, type RawBlock } from "./opsText.js";

type NodeOp = Extract<GraphOp, { op: "add_node" }>;
type FinalOp = Extract<GraphOp, { op: "final" }>;
type FinalTarget = { command: "@final" | "@final_ref"; tokens: string[]; argText: string };
type State = { blocks: RawBlock[]; nodeOps: NodeOp[]; otherOps: GraphOp[]; finals: FinalTarget[]; toolBlockIds: Set<string> };
type Handler = (tokens: string[], line: string, state: State) => void;

const NODE_TYPE = /^[a-z][a-z0-9_-]{0,63}$/;

export function parseSwx(raw: string): GraphOp[] {
  const { lines, blocks } = splitBlocks(raw);
  const unterminated = blocks.filter((block) => !block.terminated).map((block) => block.id);
  if (unterminated.length) throw new Error(`Unterminated SWX raw block${unterminated.length === 1 ? "" : "s"}: ${unterminated.join(", ")}`);
  const state: State = { blocks, nodeOps: [], otherOps: [], finals: [], toolBlockIds: new Set() };
  for (const line of mergeContinuedQuotes(lines.map((item) => item.text))) parseCommand(line.trim(), state);
  assertUnique(state);
  const finalBlockIds = new Set(state.finals.flatMap((target) => (target.command === "@final_ref" && target.tokens[0] ? [target.tokens[0]] : [])));
  const artifactBlocks = blocks.filter((block) => !state.toolBlockIds.has(block.id) && !finalBlockIds.has(block.id));
  for (const block of artifactBlocks) mergeArtifactBlock(state.nodeOps, block);
  const finalOps = state.finals.length ? state.finals.map((target) => finalOpFor(target, blocks, artifactBlocks, state.nodeOps)) : finalFromImplicitBlock(artifactBlocks);
  return [...state.nodeOps, ...state.otherOps, ...finalOps];
}

function parseCommand(line: string, state: State): void {
  if (!line.startsWith("@")) return;
  const tokens = tokenize(line);
  const command = tokens[0];
  const handler = handlers[command];
  if (!handler) throw new Error(`Unknown SWX command: ${command}`);
  handler(tokens, line, state);
}

const handlers: Record<string, Handler> = {
  "@node": (tokens, line, state) => {
    const id = tokens[1];
    const type = typeToken(tokens[2], isNodeType);
    if (!id || !type) throw new Error(`Invalid SWX @node command: ${line}`);
    const { label, attrs } = parseLabelAndAttrs(tokens.slice(3));
    const node = { id, type, text: stringAttr(attrs.text) ?? label ?? id, status: statusValue(attrs.status), confidence: numberAttr(attrs.confidence), data: dataAttrs(attrs, ["text", "status", "confidence"]) };
    state.nodeOps.push({ op: "add_node", node: withoutUndefined(node) });
  },
  "@edge": (tokens, line, state) => {
    const [, from, rawType, to] = tokens;
    const type = typeToken(rawType, isEdgeType);
    if (!from || !to || !type) throw new Error(`Invalid SWX @edge command: ${line}`);
    state.otherOps.push({ op: "add_edge", from, to, type });
  },
  "@update": (tokens, line, state) => {
    const id = tokens[1];
    if (!id) throw new Error(`Invalid SWX @update command: ${line}`);
    const { label, attrs } = parseLabelAndAttrs(tokens.slice(2));
    const type = isNodeType(attrs.type) ? attrs.type : undefined;
    const patch = withoutUndefined({ text: stringAttr(attrs.text) ?? label, type, status: statusValue(attrs.status), confidence: numberAttr(attrs.confidence), data: dataAttrs(attrs, ["text", "type", "status", "confidence"]) });
    state.otherOps.push({ op: "update_node", id, patch });
  },
  "@focus": (tokens, _line, state) => {
    state.otherOps.push(parseFocus(tokens.slice(1)));
  },
  "@zoom": (tokens, line, state) => {
    const level = tokens[1] !== undefined ? Number(tokens[1]) : NaN;
    if (!Number.isFinite(level)) throw new Error(`Invalid SWX @zoom command: ${line}`);
    state.otherOps.push({ op: "zoom", level: Math.max(0, Math.min(10, Math.floor(level))) });
  },
  "@tool": (_tokens, line, state) => {
    const { tool, argText } = parseRawToolCommand(line);
    const args = parseRawToolAttrs(argText);
    resolveToolRefs(args, state);
    state.otherOps.push({ op: "call_tool", tool, args });
  },
  "@worker": (tokens, line, state) => {
    state.otherOps.push(parseWorker(tokens.slice(1), line));
  },
  "@final": (tokens, line, state) => {
    state.finals.push({ command: "@final", tokens: tokens.slice(1), argText: line.slice("@final".length).trim() });
  },
  "@final_ref": (tokens, line, state) => {
    state.finals.push({ command: "@final_ref", tokens: tokens.slice(1), argText: line.slice("@final_ref".length).trim() });
  }
};

function assertUnique(state: State): void {
  if (state.finals.length > 1) throw new Error(`SWX transaction must contain at most one final operation; received ${state.finals.length}.`);
  const nodeIds = duplicateValues(state.nodeOps.map((op) => op.node.id));
  if (nodeIds.length) throw new Error(`SWX transaction declares duplicate node id${nodeIds.length === 1 ? "" : "s"}: ${nodeIds.join(", ")}`);
  const workerIds = duplicateValues(state.otherOps.flatMap((op) => (op.op === "spawn_worker" ? [op.id] : [])));
  if (workerIds.length) throw new Error(`SWX transaction declares duplicate worker id${workerIds.length === 1 ? "" : "s"}: ${workerIds.join(", ")}`);
}

// A quoted value may span lines (e.g. a structured @final answer); re-join lines while a quote stays open.
function mergeContinuedQuotes(lines: string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    while (index + 1 < lines.length && openQuoteChar(line) && !/^\s*(?:@|<<<)/.test(lines[index + 1])) line += "\n" + lines[++index];
    merged.push(line);
  }
  return merged;
}

function openQuoteChar(line: string): string | undefined {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\") index++;
    else if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? undefined : char;
  }
  return quote;
}

function mergeArtifactBlock(nodeOps: NodeOp[], block: RawBlock): void {
  const existing = nodeOps.find((op) => op.node.id === block.id);
  if (existing) {
    existing.node.data = { ...existing.node.data, mime: block.mime, content: block.content };
    existing.node.status = existing.node.status ?? "resolved";
    return;
  }
  nodeOps.push({ op: "add_node", node: { id: block.id, type: "artifact", text: `Artifact ${block.id}`, status: "resolved", data: { mime: block.mime, content: block.content } } });
}

function finalOpFor(target: FinalTarget, allBlocks: RawBlock[], artifactBlocks: RawBlock[], nodeOps: NodeOp[]): FinalOp {
  if (target.command === "@final_ref") return finalRefOpFor(target, allBlocks);
  const { label, attrs } = parseLabelAndAttrs(target.tokens);
  const artifactIds = artifactIdsFromAttrs(attrs);
  const answer = stringAttr(attrs.text) ?? label;
  const outcome = outcomeAttr(attrs, "@final");
  if (answer && (/^['"]/.test(target.argText) || artifactIds.length || /\s/.test(answer))) return finalOp(answer, artifactIds, outcome);
  const cleanTarget = unquote(answer ?? (target.argText.trim() || "final"));
  const node = nodeOps.find((op) => op.node.id === cleanTarget)?.node;
  if (node && (node.type === "assistant_output" || !node.data?.mime)) return finalOp(node.text);
  const artifactId = artifactBlocks.find((item) => item.id === cleanTarget)?.id ?? node?.id;
  if (artifactId) return finalOp(`Completed. See ${artifactId}.`, [artifactId]);
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(cleanTarget)) return finalOp(`Completed. See ${cleanTarget}.`, [cleanTarget]);
  return finalOp(cleanTarget, artifactIds);
}

function finalRefOpFor(target: { tokens: string[] }, blocks: RawBlock[]): FinalOp {
  const blockId = target.tokens[0];
  if (!blockId) throw new Error("Invalid SWX @final_ref command: missing final answer block id");
  const { attrs } = parseLabelAndAttrs(target.tokens.slice(1));
  const block = blocks.find((item) => item.id === blockId);
  if (!block) throw new Error(`SWX @final_ref references missing block: ${blockId}`);
  return finalOp(block.content, artifactIdsFromAttrs(attrs), outcomeAttr(attrs, "@final_ref"));
}

function outcomeAttr(attrs: Record<string, unknown>, command: string): "already_satisfied" | undefined {
  if (attrs.outcome === undefined) return undefined;
  if (attrs.outcome !== "already_satisfied") throw new Error(`Invalid SWX ${command} outcome: ${String(attrs.outcome)}`);
  return "already_satisfied";
}

function finalOp(answer: string, artifactIds: string[] = [], outcome?: "already_satisfied"): FinalOp {
  const ids = unique(artifactIds.filter(Boolean));
  return withoutUndefined({ op: "final", answer, artifactId: ids[0], artifactIds: ids.length ? ids : undefined, outcome });
}

function artifactIdsFromAttrs(attrs: Record<string, unknown>): string[] {
  const raw = stringAttr(attrs.artifacts) ?? stringAttr(attrs.artifactIds) ?? stringAttr(attrs.artifact);
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function finalFromImplicitBlock(blocks: RawBlock[]): FinalOp[] {
  const block = blocks.find((item) => item.id === "final" || item.id === "answer") ?? (blocks.length === 1 ? blocks[0] : undefined);
  return block ? [finalOp(block.content)] : [];
}

function parseLabelAndAttrs(tokens: string[]): { label?: string; attrs: Record<string, unknown> } {
  const firstAttr = tokens.findIndex(isAttrToken);
  const labelTokens = firstAttr === -1 ? tokens : tokens.slice(0, firstAttr);
  const attrs: Record<string, unknown> = {};
  for (const token of firstAttr === -1 ? [] : tokens.slice(firstAttr)) {
    if (!isAttrToken(token)) continue;
    const [key, value] = splitAttr(token);
    attrs[key] = parsePrimitive(unquote(value));
  }
  return { label: labelTokens.join(" ").trim() || undefined, attrs };
}

function parseFocus(tokens: string[]): Extract<GraphOp, { op: "focus" }> {
  const { label, attrs } = parseLabelAndAttrs(tokens);
  const explicitNode = stringAttr(attrs.node) ?? stringAttr(attrs.nodeId) ?? stringAttr(attrs.focusNodeId);
  const first = tokens[0];
  const firstIsNodeId = first && tokens.length > 1 && !isAttrToken(first) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(first);
  const nodeId = explicitNode ?? (firstIsNodeId ? first : undefined);
  const currentFocus = stringAttr(attrs.text) ?? (nodeId && tokens.length > 1 ? tokens.slice(1).join(" ").trim() : label) ?? nodeId ?? "focus";
  return withoutUndefined({ op: "focus", currentFocus, nodeId });
}

function parseWorker(tokens: string[], raw: string): Extract<GraphOp, { op: "spawn_worker" }> {
  const id = tokens[0];
  if (!id) throw new Error(`Invalid SWX @worker command: ${raw}`);
  const { label, attrs } = parseLabelAndAttrs(tokens.slice(1));
  const objective = stringAttr(attrs.objective) ?? label;
  if (!objective) throw new Error(`Invalid SWX @worker command: missing objective in ${raw}`);
  const focusNodeId = stringAttr(attrs.focusNodeId) ?? stringAttr(attrs.focus) ?? stringAttr(attrs.node) ?? stringAttr(attrs.nodeId);
  const input = stringAttr(attrs.input) ?? stringAttr(attrs.task);
  return withoutUndefined({ op: "spawn_worker", id, objective, focusNodeId, input, maxIterations: numberAttr(attrs.maxIterations) });
}

function parseRawToolCommand(line: string): { tool: string; argText: string } {
  const body = line.slice("@tool".length).trim();
  const boundary = body.search(/\s/);
  const rawTool = boundary < 0 ? body : body.slice(0, boundary);
  const tool = rawTool.startsWith("name=") ? rawTool.slice("name=".length) : rawTool;
  if (!tool) throw new Error(`Invalid SWX @tool command: ${line}`);
  return { tool, argText: boundary < 0 ? "" : body.slice(boundary).trim() };
}

function resolveToolRefs(args: Record<string, unknown>, state: State): void {
  for (const [key, value] of Object.entries(args)) {
    if (!key.endsWith("_ref")) continue;
    const targetKey = key.slice(0, -4);
    if (!targetKey) throw new Error(`Invalid SWX @tool block ref arg: ${key}`);
    if (typeof value !== "string") throw new Error(`SWX @tool ${key} must reference a block id.`);
    const block = state.blocks.find((item) => item.id === value);
    if (!block) throw new Error(`SWX @tool ${key} references missing block: ${value}`);
    args[targetKey] = block.content;
    delete args[key];
    state.toolBlockIds.add(block.id);
  }
}

// Tool args may contain unquoted spaces; values run until the next `key=` marker.
function parseRawToolAttrs(text: string): Record<string, unknown> {
  const markers = attrMarkers(text);
  const attrs: Record<string, unknown> = {};
  markers.forEach((marker, index) => {
    const end = markers[index + 1]?.start ?? text.length;
    attrs[marker.key] = parseRawToolScalar(text.slice(marker.valueStart, end).trim());
  });
  return attrs;
}

function attrMarkers(text: string): { key: string; start: number; valueStart: number }[] {
  const markers: { key: string; start: number; valueStart: number }[] = [];
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (quote) { if (char === quote) quote = undefined; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (index > 0 && !/\s/.test(text[index - 1])) continue;
    const match = text.slice(index).match(/^([A-Za-z_][A-Za-z0-9_-]*)=/);
    if (!match) continue;
    markers.push({ key: match[1], start: index, valueStart: index + match[0].length });
    index += match[0].length - 1;
  }
  return markers;
}

function parseRawToolScalar(value: string): unknown {
  const quote = value[0];
  const quoted = (quote === '"' || quote === "'") && value.length >= 2 && value.at(-1) === quote;
  return parsePrimitive(quoted ? decodeQuoted(value.slice(1, -1), quote) : value);
}

function decodeQuoted(body: string, quote: string): string {
  return body.replace(/\\(.)/g, (match, escaped: string) => {
    if (escaped === quote || escaped === "\\") return escaped;
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return match;
  });
}

function dataAttrs(attrs: Record<string, unknown>, exclude: string[]): Record<string, unknown> | undefined {
  const data = Object.fromEntries(Object.entries(attrs).filter(([key]) => !exclude.includes(key)));
  return Object.keys(data).length ? data : undefined;
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberAttr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function typeToken<T>(value: string | undefined, guard: (value: unknown) => value is T): T | undefined {
  const cleaned = value?.replace(/^\[/, "").replace(/\]:?$/, "").replace(/:$/, "");
  return guard(cleaned) ? cleaned : undefined;
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && NODE_TYPE.test(value);
}

function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === "string" && (edgeTypes as readonly string[]).includes(value);
}
