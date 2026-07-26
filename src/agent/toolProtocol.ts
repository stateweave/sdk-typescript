import { defaultSemanticNodeTypes, type SemanticNodeType } from "./types.js";
import type { Tool } from "../tools/types.js";

export type SemanticNodeInput = { type: string; key: string; content: unknown };
export type ParsedToolCall = { name: string; args: unknown; state: SemanticNodeInput[] };
export type ParsedFinal = { answer: string; state: SemanticNodeInput[] };

export type CompletionEvidence = {
  inspected: boolean;
  inspectedPaths: Set<string>;
  mutated: boolean;
  mutatedPaths: Set<string>;
  mutationBeforeInspection: boolean;
  checked: boolean;
  restarted: boolean;
  smoked: boolean;
};

export function createCompletionEvidence(): CompletionEvidence {
  return { inspected: false, inspectedPaths: new Set(), mutated: false, mutatedPaths: new Set(), mutationBeforeInspection: false, checked: false, restarted: false, smoked: false };
}

export async function executeAgentTool(tools: Map<string, Tool>, call: { name: string; args: unknown }): Promise<unknown> {
  const tool = tools.get(call.name);
  if (!tool) return { error: `Unknown tool: ${call.name}`, availableTools: [...tools.keys()] };
  try {
    return await tool.execute(tool.schema.parse(call.args));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function recordCompletionEvidence(evidence: CompletionEvidence, toolName: string, args: unknown, result: unknown): void {
  if (!toolResultSucceeded(result)) return;
  const toolArgs = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const filePath = String(toolArgs.file_path ?? toolArgs.path ?? "");
  if (toolName === "read_file") {
    evidence.inspected = true;
    if (filePath) evidence.inspectedPaths.add(filePath);
  }
  if (toolName === "write_file" || toolName === "edit_file") {
    if (toolName === "edit_file" && filePath && !evidence.inspectedPaths.has(filePath) && !evidence.mutatedPaths.has(filePath)) evidence.mutationBeforeInspection = true;
    evidence.mutated = true;
    if (filePath) evidence.mutatedPaths.add(filePath);
    evidence.checked = false;
    evidence.restarted = false;
    evidence.smoked = false;
  }
  if (toolName === "bash_command" && args && typeof args === "object" && /\bnode\s+--check\b/.test(String((args as Record<string, unknown>).command ?? ""))) evidence.checked = true;
  if (toolName !== "app_control" || !args || typeof args !== "object") return;
  const action = (args as Record<string, unknown>).action;
  if (action === "check") evidence.checked = true;
  if (action === "restart") {
    evidence.restarted = true;
    evidence.smoked = true;
  }
  if (action === "smoke") evidence.smoked = true;
}

export function completionEvidenceGaps(task: string, evidence: CompletionEvidence, answer: string): string[] {
  const lower = task.toLowerCase();
  const alreadySatisfied = /already (?:satisfied|implemented|present|complete)|no changes? (?:were )?(?:needed|required)/i.test(answer);
  const gaps: string[] = [];
  if (/\b(?:read|inspect|review)\b/.test(lower) && !evidence.inspected) gaps.push("workspace inspection");
  if (/\b(?:add|apply|build|fix|harden|implement|update|write)\b/.test(lower) && !evidence.mutated && !alreadySatisfied) gaps.push("a confirmed file mutation or an explicit already-satisfied finding");
  if (evidence.mutationBeforeInspection) gaps.push("inspection before mutation");
  if (/\b(?:check|checks|test|tests|syntax)\b/.test(lower) && !evidence.checked) gaps.push("a successful fixed check");
  if (/\brestart\b/.test(lower) && !evidence.restarted) gaps.push("a successful restart");
  if (/\bsmoke(?:-test|-check| test| check)?\b/.test(lower) && !evidence.smoked) gaps.push("a successful smoke check");
  return gaps;
}

export function providerSystem(common: string | undefined, instruction: string): string {
  return common ?? instruction;
}

export function agentSystemPrompt(systemPrompt: string, tools: Tool[], nodeTypes: SemanticNodeType[] = defaultSemanticNodeTypes, allowDynamicNodeTypes = false): string {
  const stateFormat = 'Optional state entries use {"type":"type_name","key":"stable-key","content":"durable content or structured data"}.';
  return [
    systemPrompt,
    tools.length ? "You have a persistent workspace and must use tools to inspect current files before changing them." : "Answer from the supplied causal state and the current request; no tools are available.",
    "Use the supplied working context deliberately. The runtime, not you, creates causal links and validates persistent state.",
    `You may preserve up to 8 durable semantic nodes in the state array of a TOOL_CALL or structured FINAL. ${stateFormat}`,
    "Preserve only explicit stable facts, confirmed preferences, reusable evidence-supported wisdom, and durable artifact content or references. Do not save guesses, routine prose, transient requests, secrets, or duplicates. Reuse the same type and key to supersede an older value.",
    `Configured semantic node types: ${nodeTypes.map((type) => `${type.name} (${type.description})`).join("; ")}.`,
    allowDynamicNodeTypes ? "You may create a concise lowercase custom semantic type when none of the configured types fits." : "Use only the configured semantic node types.",
    tools.length ? "For one tool action, return exactly TOOL_CALL followed by one JSON object: {\"name\":\"tool_name\",\"args\":{...},\"state\":[...]}. Keep each write_file content value under 2,500 characters and build longer artifacts through multiple write/edit calls so the JSON envelope cannot be truncated." : "Do not return TOOL_CALL because no tools are available.",
    "Finish with either FINAL: followed by a concise human answer, or FINAL followed by one JSON object: {\"answer\":\"concise human answer\",\"state\":[...]}. State entries are optional and are never shown as the human answer.",
    tools.length ? "Never claim a file changed unless a write_file or edit_file result confirms it. Prefer read_file before edit_file. bash_command is read-only and allowlisted." : "Do not claim external actions occurred.",
    "Available tools:",
    ...(tools.length ? tools.map((tool) => `- ${tool.name}: ${tool.description}`) : ["- none"])
  ].join("\n");
}

export function parseToolCall(text: string): ParsedToolCall | undefined {
  const envelope = text.match(/^\s*TOOL_CALL\s*/i);
  if (!envelope) return undefined;
  const start = envelope[0].length;
  if (text[start] !== "{") return undefined;
  const line = text.slice(start).split(/\r?\n/, 1)[0]!.trim();
  const raw = balancedJsonObject(text, start) ?? line;
  const trailingQuoteRepair = repairMissingTrailingQuote(raw);
  const candidates = [raw, trailingQuoteRepair, trailingQuoteRepair ? repairCommandValueQuotes(trailingQuoteRepair) : undefined, repairCommandValueQuotes(raw)];
  for (const json of new Set(candidates.filter((value): value is string => Boolean(value)))) {
    try {
      const parsed = JSON.parse(json) as { name?: unknown; args?: unknown; state?: unknown };
      if (typeof parsed.name !== "string" || !parsed.args || typeof parsed.args !== "object" || Array.isArray(parsed.args)) continue;
      return { name: parsed.name, args: parsed.args, state: readSemanticNodeInputs(parsed.state) };
    } catch {
      continue;
    }
  }
  return undefined;
}

export function parseFinal(text: string): ParsedFinal | undefined {
  const envelope = text.match(/^\s*FINAL\s*/i);
  if (!envelope) return undefined;
  const remainder = text.slice(envelope[0].length).trimStart();
  const payload = remainder.replace(/^:\s*/, "");
  if (!payload.startsWith("{")) {
    const answer = payload.trim();
    return answer ? { answer, state: [] } : undefined;
  }
  const raw = balancedJsonObject(payload, 0);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown; state?: unknown };
    if (typeof parsed.answer !== "string" || !parsed.answer.trim()) return undefined;
    return { answer: parsed.answer.trim(), state: readSemanticNodeInputs(parsed.state) };
  } catch {
    return undefined;
  }
}

function readSemanticNodeInputs(value: unknown): SemanticNodeInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.type !== "string" || typeof record.key !== "string" || !("content" in record)) return [];
    return [{ type: record.type, key: record.key, content: record.content }];
  });
}

function toolResultSucceeded(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const record = result as Record<string, unknown>;
  if (record.error !== undefined || record.ok === false) return false;
  return typeof record.exitCode !== "number" || record.exitCode === 0;
}

function repairMissingTrailingQuote(value: string): string | undefined {
  const suffix = value.match(/}+$/)?.[0];
  if (!suffix || countUnescapedQuotes(value) % 2 === 0) return undefined;
  return `${value.slice(0, -suffix.length)}"${suffix}`;
}

function repairCommandValueQuotes(value: string): string | undefined {
  const marker = /"command"\s*:\s*"/.exec(value);
  if (!marker) return undefined;
  const start = marker.index + marker[0].length;
  let escaped = false;
  let closing = -1;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character !== "\"") continue;
    if (/^\s*(?:}\s*}|,\s*"[^"]+"\s*:)/.test(value.slice(index + 1))) { closing = index; break; }
  }
  if (closing < 0) return undefined;
  return `${value.slice(0, start)}${escapeUnescapedQuotes(value.slice(start, closing))}${value.slice(closing)}`;
}

function escapeUnescapedQuotes(value: string): string {
  let output = "";
  let escaped = false;
  for (const character of value) {
    if (character === "\"" && !escaped) output += "\\";
    output += character;
    if (character === "\\") escaped = !escaped;
    else escaped = false;
  }
  return output;
}

function countUnescapedQuotes(value: string): number {
  let quotes = 0;
  let escaped = false;
  for (const character of value) {
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === "\"") quotes += 1;
  }
  return quotes;
}

function balancedJsonObject(text: string, start: number): string | undefined {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === "\"") { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
