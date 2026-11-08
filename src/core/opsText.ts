// Shared lexing for the SW2 grammar and the SWX/1 compatibility parser.

export type RawBlock = { id: string; mime: string; content: string; terminated: boolean };
export type SourceLine = { text: string; lineNo: number };
export type Token = { value: string; quoted: boolean };

const BLOCK_START = /^<<<([A-Za-z0-9_.-]+)(?::([^\s>]+))?\s*$/;

/** Splits raw output into command lines and `<<<id[:mime] … >>>` raw blocks. */
export function splitBlocks(raw: string): { lines: SourceLine[]; blocks: RawBlock[] } {
  const source = raw.split(/\r?\n/);
  const lines: SourceLine[] = [];
  const blocks: RawBlock[] = [];
  for (let index = 0; index < source.length; index++) {
    const start = source[index].match(BLOCK_START);
    if (!start) {
      lines.push({ text: source[index], lineNo: index + 1 });
      continue;
    }
    const content: string[] = [];
    index++;
    while (index < source.length && source[index].trim() !== ">>>") content.push(source[index++]);
    blocks.push({ id: start[1], mime: start[2] ?? "text/plain", content: content.join("\n"), terminated: index < source.length });
  }
  return { lines, blocks };
}

/** Whitespace tokenizer with quote and backslash-escape support. Reports an unterminated quote. */
export function lex(line: string): { tokens: Token[]; openQuote: boolean } {
  const tokens: Token[] = [];
  let current = "";
  let quoted = false;
  let quote: string | undefined;
  let started = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === "\\" && index + 1 < line.length) {
        current += unescapeChar(line[++index]);
      } else if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push({ value: current, quoted });
      current = "";
      quoted = false;
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push({ value: current, quoted });
  return { tokens, openQuote: Boolean(quote) };
}

export function tokenize(line: string): string[] {
  return lex(line).tokens.map((token) => token.value).filter(Boolean);
}

function unescapeChar(char: string): string {
  if (char === "n") return "\n";
  if (char === "r") return "\r";
  if (char === "t") return "\t";
  return char;
}

export function isAttrToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*=/.test(token);
}

export function splitAttr(token: string): [string, string] {
  const index = token.indexOf("=");
  return [token.slice(0, index), token.slice(index + 1)];
}

export function parsePrimitive(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const numeric = Number(value);
  if (/^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(numeric)) return numeric;
  return value;
}

export function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function statusValue(value: unknown): "active" | "resolved" | "rejected" | "stale" | undefined {
  return value === "active" || value === "resolved" || value === "rejected" || value === "stale" ? value : undefined;
}
