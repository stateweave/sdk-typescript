// SW2: the strict, small GraphOps grammar. Fixed positions, one raw-block form, no repair.
//
//   SW2
//   T <tool> key=value …            call one tool (key_ref=<block> for multiline values)
//   F "answer" [artifacts=a,b] [outcome=already_satisfied]
//   F ref=<block> [artifacts=a,b] [outcome=already_satisfied]
//   N <id> <type> "label" [status]  add a node; a block with the same id becomes its content
//   E <from> <edge_type> <to>       add an edge
//   R <id> [status]                 set node status (default resolved)
//   <<<id[:mime]
//   …raw text…
//   >>>

import { edgeTypes, type EdgeType, type GraphOp } from "./types.js";
import { duplicateValues, isAttrToken, lex, parsePrimitive, splitAttr, splitBlocks, statusValue, withoutUndefined, type RawBlock, type SourceLine, type Token } from "./opsText.js";

export const SW2_HEADER = "SW2";

export const sw2Forms = {
  T: "T <tool> key=value … (key_ref=<block> for multiline values)",
  F: 'F "answer" [artifacts=a,b] [outcome=already_satisfied] | F ref=<block> […]',
  N: 'N <id> <type> "label" [active|resolved|rejected|stale]',
  E: `E <from> <edge_type> <to> (edge_type: ${edgeTypes.join("|")})`,
  R: "R <id> [active|resolved|rejected|stale]"
} as const;

type OpCode = keyof typeof sw2Forms;
type Context = { blocks: Map<string, RawBlock>; usedBlocks: Set<string> };
type LineParser = (tokens: Token[], line: SourceLine, context: Context) => GraphOp;

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const NODE_TYPE = /^[a-z][a-z0-9_-]{0,63}$/;
const TOOL = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export class Sw2SyntaxError extends Error {
  constructor(line: SourceLine | undefined, expected: string, detail?: string) {
    const where = line ? `SW2 line ${line.lineNo}` : "SW2";
    const got = line ? `; got: ${line.text.trim().slice(0, 160)}` : "";
    super(`${where}: expected ${expected}${detail ? ` (${detail})` : ""}${got}`);
    this.name = "Sw2SyntaxError";
  }
}

export function isSw2(raw: string): boolean {
  return new RegExp(`^\\s*${SW2_HEADER}[\\t ]*(?:\\r?\\n|$)`).test(raw);
}

export function parseSw2(raw: string): GraphOp[] {
  const { lines, blocks } = splitBlocks(raw.trim());
  const unterminated = blocks.find((block) => !block.terminated);
  if (unterminated) throw new Sw2SyntaxError(undefined, `">>>" closing <<<${unterminated.id}`);
  const duplicateBlocks = duplicateValues(blocks.map((block) => block.id));
  if (duplicateBlocks.length) throw new Sw2SyntaxError(undefined, "unique block ids", `duplicate: ${duplicateBlocks.join(", ")}`);
  const context: Context = { blocks: new Map(blocks.map((block) => [block.id, block])), usedBlocks: new Set() };
  const ops = lines.slice(1).flatMap((line) => parseLine(line, context));
  attachNodeBlocks(ops, context);
  assertTransactionShape(ops);
  return ops;
}

function parseLine(line: SourceLine, context: Context): GraphOp[] {
  const text = line.text.trim();
  if (!text || text.startsWith("#")) return [];
  const { tokens, openQuote } = lex(text);
  if (openQuote) throw new Sw2SyntaxError(line, "a closed quote", "for multiline text use a <<<block … >>> and a *_ref");
  const code = tokens[0]?.quoted ? undefined : tokens[0]?.value;
  const parser = code && code in parsers ? parsers[code as OpCode] : undefined;
  if (!parser) throw new Sw2SyntaxError(line, "one of T F N E R at line start");
  return [parser(tokens, line, context)];
}

const parsers: Record<OpCode, LineParser> = {
  T: (tokens, line, context) => {
    const tool = bare(tokens[1]);
    if (!tool || !TOOL.test(tool)) throw new Sw2SyntaxError(line, sw2Forms.T);
    return { op: "call_tool", tool, args: attrs(tokens.slice(2), line, sw2Forms.T, context) };
  },
  F: (tokens, line, context) => {
    const head = tokens[1];
    const answerFromText = head?.quoted ? head.value : undefined;
    const rest = answerFromText === undefined ? tokens.slice(1) : tokens.slice(2);
    const { ref, artifacts, outcome, ...extra } = attrs(rest, line, sw2Forms.F, context, false);
    if (Object.keys(extra).length) throw new Sw2SyntaxError(line, sw2Forms.F, `unknown keys: ${Object.keys(extra).join(", ")}`);
    const answer = answerFromText ?? (typeof ref === "string" ? blockContent(ref, line, context) : undefined);
    if (!answer || (answerFromText !== undefined && ref !== undefined)) throw new Sw2SyntaxError(line, sw2Forms.F);
    if (outcome !== undefined && outcome !== "already_satisfied") throw new Sw2SyntaxError(line, sw2Forms.F, "outcome must be already_satisfied");
    const ids = typeof artifacts === "string" ? artifacts.split(",").map((id) => id.trim()).filter(Boolean) : [];
    return withoutUndefined({ op: "final", answer, artifactId: ids[0], artifactIds: ids.length ? ids : undefined, outcome: outcome as "already_satisfied" | undefined });
  },
  N: (tokens, line) => {
    const [, id, type, label, status, ...extra] = tokens;
    const validStatus = status === undefined || (!status.quoted && statusValue(status.value));
    if (!idToken(id) || !type || type.quoted || !NODE_TYPE.test(type.value) || !label?.value || !validStatus || extra.length) {
      throw new Sw2SyntaxError(line, sw2Forms.N);
    }
    return { op: "add_node", node: withoutUndefined({ id: id!.value, type: type.value, text: label.value, status: statusValue(status?.value) ?? "active" }) };
  },
  E: (tokens, line) => {
    const [, from, type, to, ...extra] = tokens;
    if (!idToken(from) || !idToken(to) || !type || !isEdgeType(type.value) || extra.length) throw new Sw2SyntaxError(line, sw2Forms.E);
    return { op: "add_edge", from: from!.value, type: type.value, to: to!.value };
  },
  R: (tokens, line) => {
    const [, id, status, ...extra] = tokens;
    const next = status === undefined ? "resolved" : statusValue(status.value);
    if (!idToken(id) || !next || extra.length) throw new Sw2SyntaxError(line, sw2Forms.R);
    return { op: "update_node", id: id!.value, patch: { status: next } };
  }
};

function attrs(tokens: Token[], line: SourceLine, form: string, context: Context, resolveRefs = true): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const token of tokens) {
    if (!isAttrToken(token.value)) throw new Sw2SyntaxError(line, form, `"${token.value.slice(0, 40)}" is not key=value`);
    const [key, value] = splitAttr(token.value);
    if (key in result) throw new Sw2SyntaxError(line, form, `duplicate key ${key}`);
    const target = resolveRefs && key.endsWith("_ref") ? key.slice(0, -4) : key;
    if (target !== key && target in result) throw new Sw2SyntaxError(line, form, `duplicate key ${target}`);
    result[target] = target !== key ? blockContent(value, line, context) : token.quoted ? value : parsePrimitive(value);
  }
  return result;
}

function blockContent(id: string, line: SourceLine, context: Context): string {
  const block = context.blocks.get(id);
  if (!block) throw new Sw2SyntaxError(line, `a <<<${id} … >>> block`, "referenced block is missing");
  context.usedBlocks.add(id);
  return block.content;
}

function attachNodeBlocks(ops: GraphOp[], context: Context): void {
  for (const block of context.blocks.values()) {
    if (context.usedBlocks.has(block.id)) continue;
    const node = ops.find((op): op is Extract<GraphOp, { op: "add_node" }> => op.op === "add_node" && op.node.id === block.id);
    if (!node) throw new Sw2SyntaxError(undefined, `block <<<${block.id} to be used by a *_ref, F ref=, or an N ${block.id} line`);
    node.node.data = { mime: block.mime, content: block.content };
  }
}

function assertTransactionShape(ops: GraphOp[]): void {
  if (!ops.length) throw new Sw2SyntaxError(undefined, "at least one T, F, N, E, or R line after SW2");
  if (ops.filter((op) => op.op === "final").length > 1) throw new Sw2SyntaxError(undefined, "at most one F line");
  const duplicates = duplicateValues(ops.flatMap((op) => (op.op === "add_node" ? [op.node.id] : [])));
  if (duplicates.length) throw new Sw2SyntaxError(undefined, "unique N ids", `duplicate: ${duplicates.join(", ")}`);
}

function bare(token: Token | undefined): string | undefined {
  return token && !token.quoted ? token.value : undefined;
}

function idToken(token: Token | undefined): boolean {
  return Boolean(token && !token.quoted && ID.test(token.value));
}

function isEdgeType(value: string): value is EdgeType {
  return (edgeTypes as readonly string[]).includes(value);
}
