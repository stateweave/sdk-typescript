import { z } from "zod";
import type { EdgeType, GraphOp, NodeType } from "./types.js";

export const nodeTypeSchema = z.enum([
  "system",
  "user_input",
  "assistant_output",
  "artifact",
  "intent",
  "constraint",
  "fact",
  "hypothesis",
  "decision",
  "tool_call",
  "tool_result",
  "test_result",
  "patch",
  "risk",
  "question"
]);

export const edgeTypeSchema = z.enum([
  "follows",
  "creates",
  "supports",
  "contradicts",
  "explains",
  "depends_on",
  "addresses",
  "validates",
  "constrains",
  "causes",
  "relates_to"
]);

export const graphNodeWithoutCreatedAtSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  text: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "resolved", "rejected", "stale"]).optional()
});

export const graphOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: graphNodeWithoutCreatedAtSchema }),
  z.object({ op: z.literal("add_edge"), from: z.string().min(1), to: z.string().min(1), type: edgeTypeSchema }),
  z.object({
    op: z.literal("update_node"),
    id: z.string().min(1),
    patch: z.object({
      id: z.string().optional(),
      type: nodeTypeSchema.optional(),
      text: z.string().optional(),
      data: z.record(z.unknown()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      status: z.enum(["active", "resolved", "rejected", "stale"]).optional(),
      createdAt: z.string().optional()
    })
  }),
  z.object({ op: z.literal("focus"), currentFocus: z.string().min(1), nodeId: z.string().min(1).optional() }),
  z.object({ op: z.literal("call_tool"), tool: z.string().min(1), args: z.record(z.unknown()) }),
  z.object({ op: z.literal("final"), answer: z.string().min(1), artifactId: z.string().min(1).optional() })
]);

export const graphOpsResponseSchema = z.object({ ops: z.array(graphOpSchema).min(1) });

type SwxBlock = { id: string; mime: string; content: string };

export function parseAndValidateOps(raw: string): GraphOp[] {
  const text = stripFence(raw.trim());
  const swxStart = text.indexOf("SWX/1");
  if (swxStart >= 0) return parseSwx(text.slice(swxStart));

  try {
    const parsed = JSON.parse(extractJsonObject(text)) as unknown;
    return graphOpsResponseSchema.parse(parsed).ops;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Model returned invalid StateWeave exchange. Expected SWX/1; legacy JSON parse failed: ${error.message}`);
    }
    throw error;
  }
}

function parseSwx(raw: string): GraphOp[] {
  const { commands, blocks } = extractBlocks(raw);
  const nodeOps: Extract<GraphOp, { op: "add_node" }>[] = [];
  const otherOps: GraphOp[] = [];
  const finalTargets: string[] = [];

  for (const line of commands.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "SWX/1" || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("@")) continue;

    const tokens = tokenize(trimmed);
    const command = tokens[0];

    if (command === "@node") {
      const id = tokens[1];
      const type = nodeTypeToken(tokens[2]);
      if (!id || !type) throw new Error(`Invalid SWX @node command: ${trimmed}`);
      const { label, attrs } = parseLabelAndAttrs(tokens.slice(3));
      const node = {
        id,
        type,
        text: stringAttr(attrs.text) ?? label ?? id,
        status: statusAttr(attrs.status),
        confidence: numberAttr(attrs.confidence),
        data: dataAttrs(attrs, ["text", "status", "confidence"])
      };
      nodeOps.push({ op: "add_node", node: withoutUndefined(node) });
      continue;
    }

    if (command === "@edge") {
      const from = tokens[1];
      const type = edgeTypeToken(tokens[2]);
      const to = tokens[3];
      if (!from || !to || !type) throw new Error(`Invalid SWX @edge command: ${trimmed}`);
      otherOps.push({ op: "add_edge", from, to, type });
      continue;
    }

    if (command === "@update") {
      const id = tokens[1];
      if (!id) throw new Error(`Invalid SWX @update command: ${trimmed}`);
      const { label, attrs } = parseLabelAndAttrs(tokens.slice(2));
      const patch = withoutUndefined({
        text: stringAttr(attrs.text) ?? label,
        type: nodeTypeAttr(attrs.type),
        status: statusAttr(attrs.status),
        confidence: numberAttr(attrs.confidence),
        data: dataAttrs(attrs, ["text", "type", "status", "confidence"])
      });
      otherOps.push({ op: "update_node", id, patch });
      continue;
    }

    if (command === "@focus") {
      const focus = parseFocus(tokens.slice(1));
      if (focus.currentFocus) otherOps.push(focus);
      continue;
    }

    if (command === "@tool") {
      const tool = tokens[1];
      if (!tool) throw new Error(`Invalid SWX @tool command: ${trimmed}`);
      otherOps.push({ op: "call_tool", tool, args: parseAttrs(tokens.slice(2)) });
      continue;
    }

    if (command === "@final") {
      finalTargets.push(tokens.slice(1).join(" ").trim() || "final");
      continue;
    }
  }

  for (const block of blocks) mergeArtifactBlock(nodeOps, block);
  const finalOps = finalTargets.length ? finalTargets.map((target) => finalOpFor(target, blocks, nodeOps)) : finalFromImplicitBlock(blocks);
  const parsed = graphOpsResponseSchema.parse({ ops: [...nodeOps, ...otherOps, ...finalOps] }).ops;
  if (!parsed.length) throw new Error("Model returned SWX/1 but no graph operations were found.");
  return parsed;
}

function extractBlocks(raw: string): { commands: string; blocks: SwxBlock[] } {
  const lines = raw.split(/\r?\n/);
  const commandLines: string[] = [];
  const blocks: SwxBlock[] = [];

  for (let index = 0; index < lines.length; index++) {
    const start = lines[index].match(/^<<<([A-Za-z0-9_.:-]+)(?::([^\s>]+))?\s*$/);
    if (!start) {
      commandLines.push(lines[index]);
      continue;
    }

    const id = start[1];
    const mime = start[2] ?? "text/plain";
    const content: string[] = [];
    index++;
    while (index < lines.length && lines[index].trim() !== ">>>") {
      content.push(lines[index]);
      index++;
    }
    if (index >= lines.length) throw new Error(`Unterminated SWX block: ${id}`);
    blocks.push({ id, mime, content: content.join("\n") });
  }

  return { commands: commandLines.join("\n"), blocks };
}

function mergeArtifactBlock(nodeOps: Extract<GraphOp, { op: "add_node" }>[], block: SwxBlock): void {
  const existing = nodeOps.find((op) => op.node.id === block.id);
  if (existing) {
    existing.node.type = existing.node.type === "artifact" ? "artifact" : existing.node.type;
    existing.node.data = { ...existing.node.data, mime: block.mime, content: block.content };
    existing.node.status = existing.node.status ?? "resolved";
    return;
  }

  nodeOps.push({
    op: "add_node",
    node: {
      id: block.id,
      type: "artifact",
      text: `Artifact ${block.id}`,
      status: "resolved",
      data: { mime: block.mime, content: block.content }
    }
  });
}

function finalOpFor(target: string, blocks: SwxBlock[], nodeOps: Extract<GraphOp, { op: "add_node" }>[]): Extract<GraphOp, { op: "final" }> {
  const cleanTarget = unquote(target);
  const block = blocks.find((item) => item.id === cleanTarget);
  if (block) return { op: "final", answer: block.content, artifactId: block.id };

  const node = nodeOps.find((op) => op.node.id === cleanTarget)?.node;
  if (node?.type === "artifact" && typeof node.data?.content === "string") return { op: "final", answer: node.data.content, artifactId: node.id };
  if (node?.type === "artifact") return { op: "final", answer: node.text, artifactId: node.id };
  if (node) return { op: "final", answer: node.text };

  return { op: "final", answer: cleanTarget };
}

function finalFromImplicitBlock(blocks: SwxBlock[]): Extract<GraphOp, { op: "final" }>[] {
  const block = blocks.find((item) => item.id === "final" || item.id === "answer");
  return block ? [{ op: "final", answer: block.content, artifactId: block.id }] : [];
}

function parseLabelAndAttrs(tokens: string[]): { label?: string; attrs: Record<string, unknown> } {
  const firstAttr = tokens.findIndex(isAttrToken);
  const labelTokens = firstAttr === -1 ? tokens : tokens.slice(0, firstAttr);
  const attrTokens = firstAttr === -1 ? [] : tokens.slice(firstAttr);
  const label = labelTokens.join(" ").trim() || undefined;
  return { label, attrs: parseAttrs(attrTokens) };
}

function parseFocus(tokens: string[]): Extract<GraphOp, { op: "focus" }> {
  const { label, attrs } = parseLabelAndAttrs(tokens);
  const explicitNode = stringAttr(attrs.node) ?? stringAttr(attrs.nodeId) ?? stringAttr(attrs.focusNodeId);
  const first = tokens[0];
  const firstLooksLikeNodeId = first && !isAttrToken(first) && /^(?:[A-Za-z][A-Za-z0-9_-]*_\d+|system_root)$/.test(first);
  const nodeId = explicitNode ?? (firstLooksLikeNodeId ? first : undefined);
  const currentFocus = stringAttr(attrs.text) ?? (nodeId && tokens.length > 1 ? tokens.slice(1).join(" ").trim() : label) ?? nodeId ?? "focus";
  return withoutUndefined({ op: "focus", currentFocus, nodeId });
}

function parseAttrs(tokens: string[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const token of tokens) {
    if (!isAttrToken(token)) continue;
    const index = token.indexOf("=");
    attrs[token.slice(0, index)] = parseScalar(token.slice(index + 1));
  }
  return attrs;
}

function isAttrToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*=/.test(token);
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === "\\" && index + 1 < line.length) {
        current += line[index + 1];
        index++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseScalar(value: string): unknown {
  const unquoted = unquote(value);
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  const numeric = Number(unquoted);
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted) && Number.isFinite(numeric)) return numeric;
  return unquoted;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function dataAttrs(attrs: Record<string, unknown>, exclude: string[]): Record<string, unknown> | undefined {
  const data = Object.fromEntries(Object.entries(attrs).filter(([key]) => !exclude.includes(key)));
  return Object.keys(data).length ? data : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberAttr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function statusAttr(value: unknown): "active" | "resolved" | "rejected" | "stale" | undefined {
  return value === "active" || value === "resolved" || value === "rejected" || value === "stale" ? value : undefined;
}

function nodeTypeAttr(value: unknown): NodeType | undefined {
  return isNodeType(value) ? value : undefined;
}

function nodeTypeToken(value: unknown): NodeType | undefined {
  const cleaned = cleanTypeToken(value);
  return isNodeType(cleaned) ? cleaned : undefined;
}

function edgeTypeToken(value: unknown): EdgeType | undefined {
  const cleaned = cleanTypeToken(value);
  return isEdgeType(cleaned) ? cleaned : undefined;
}

function cleanTypeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/^\[/, "").replace(/\]:?$/, "").replace(/:$/, "");
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && nodeTypeSchema.safeParse(value).success;
}

function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === "string" && edgeTypeSchema.safeParse(value).success;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  if (fenced) return fenced;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start > 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function stripFence(raw: string): string {
  return raw.match(/^```(?:swx|stateweave|text)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? raw;
}
