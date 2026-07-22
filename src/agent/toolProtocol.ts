import type { Tool } from "../tools/types.js";

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

export function agentSystemPrompt(systemPrompt: string, tools: Tool[]): string {
  return [
    systemPrompt,
    "You have a persistent workspace and must use tools to inspect current files before changing them.",
    "Use the supplied working context deliberately: preserve active tasks, constraints, file paths, implementation decisions, failures, and successful check evidence, while treating current workspace reads as authoritative.",
    "For one tool action, return exactly TOOL_CALL followed by one JSON object: {\"name\":\"tool_name\",\"args\":{...}}. Keep each write_file content value under 2,500 characters and build longer artifacts through multiple write/edit calls so the JSON envelope cannot be truncated.",
    "After a TOOL result, either call another tool or finish with exactly FINAL: followed by a concise human answer.",
    "Never claim a file changed unless a write_file or edit_file result confirms it. Prefer read_file before edit_file. bash_command is read-only and allowlisted.",
    "Available tools:",
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}`)
  ].join("\n");
}

export function parseToolCall(text: string): { name: string; args: unknown } | undefined {
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
      const parsed = JSON.parse(json) as { name?: unknown; args?: unknown };
      if (typeof parsed.name !== "string" || !parsed.args || typeof parsed.args !== "object" || Array.isArray(parsed.args)) continue;
      return { name: parsed.name, args: parsed.args };
    } catch {
      continue;
    }
  }
  return undefined;
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
