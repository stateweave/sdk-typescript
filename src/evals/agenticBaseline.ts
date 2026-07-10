import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";

export type AgenticMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };

export type AgenticTurnResult = {
  answer: string;
  contextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  tokenCountSource: "provider" | "estimated";
  modelCalls: number;
  toolCalls: number;
  latencyMs: number;
};

export class AgenticBaseline {
  private readonly model: Model;
  private readonly tools: Map<string, Tool>;
  private readonly maxIterations: number;
  private readonly maxContextTokens: number;
  private messages: AgenticMessage[];

  constructor(args: { model: Model; tools: Tool[]; systemPrompt: string; maxIterations?: number; maxContextTokens?: number; messages?: AgenticMessage[] }) {
    this.model = args.model;
    this.tools = new Map(args.tools.map((tool) => [tool.name, tool]));
    this.maxIterations = args.maxIterations ?? 12;
    this.maxContextTokens = args.maxContextTokens ?? 96_000;
    this.messages = args.messages?.length ? structuredClone(args.messages) : [{ role: "system", content: baselineSystemPrompt(args.systemPrompt, args.tools) }];
  }

  getMessages(): AgenticMessage[] {
    return structuredClone(this.messages);
  }

  async run(task: string): Promise<AgenticTurnResult> {
    const startedAt = Date.now();
    let contextTokens = 0;
    let totalInputTokens = 0;
    let outputTokens = 0;
    let tokenCountSource: "provider" | "estimated" = "provider";
    let toolCalls = 0;

    this.messages.push({ role: "user", content: task });
    this.truncate();

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      const prompt = serializeAgenticMessages(this.messages);
      const output = await this.model.complete({ prompt, mode: "text", system: "Follow the transcript's SYSTEM tool protocol exactly. Return one TOOL_CALL JSON object or one FINAL response." });
      const estimatedInput = estimateStateWeaveTokens(prompt).estimatedTokens;
      const estimatedOutput = estimateStateWeaveTokens(output.text).estimatedTokens;
      contextTokens = output.usage?.inputTokens ?? estimatedInput;
      totalInputTokens += contextTokens;
      outputTokens += output.usage?.outputTokens ?? estimatedOutput;
      if (!output.usage) tokenCountSource = "estimated";
      this.messages.push({ role: "assistant", content: output.text });

      const call = parseToolCall(output.text);
      if (!call) {
        const answer = output.text.replace(/^\s*FINAL\s*:?\s*/i, "").trim();
        return { answer, contextTokens, totalInputTokens, outputTokens, tokenCountSource, modelCalls: iteration, toolCalls, latencyMs: Date.now() - startedAt };
      }

      const tool = this.tools.get(call.name);
      let result: unknown;
      if (!tool) result = { error: `Unknown tool: ${call.name}`, availableTools: [...this.tools.keys()] };
      else {
        try {
          result = await tool.execute(tool.schema.parse(call.args));
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
      }
      toolCalls += 1;
      this.messages.push({ role: "tool", content: `${call.name}: ${JSON.stringify(result)}` });
      this.truncate();
    }

    throw new Error(`Naive agent recursion limit reached after ${this.maxIterations} iterations.`);
  }

  private truncate(): void {
    while (this.messages.length > 2 && estimateStateWeaveTokens(serializeAgenticMessages(this.messages)).estimatedTokens > this.maxContextTokens) {
      this.messages.splice(1, 1);
    }
  }
}

export function serializeAgenticMessages(messages: AgenticMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function baselineSystemPrompt(systemPrompt: string, tools: Tool[]): string {
  return [
    systemPrompt,
    "You have a persistent workspace and must use tools to inspect current files before changing them.",
    "For one tool action, return exactly TOOL_CALL followed by one JSON object: {\"name\":\"tool_name\",\"args\":{...}}.",
    "After a TOOL result, either call another tool or finish with exactly FINAL: followed by a concise human answer.",
    "Never claim a file changed unless a write_file or edit_file result confirms it. Prefer read_file before edit_file. bash_command is read-only and allowlisted.",
    "Available tools:",
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}`)
  ].join("\n");
}

function parseToolCall(text: string): { name: string; args: unknown } | undefined {
  const marker = text.search(/TOOL_CALL/i);
  if (marker < 0) return undefined;
  const start = text.indexOf("{", marker);
  if (start < 0) return undefined;
  const json = balancedJsonObject(text, start);
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as { name?: unknown; args?: unknown };
    if (typeof parsed.name !== "string" || !parsed.args || typeof parsed.args !== "object" || Array.isArray(parsed.args)) return undefined;
    return { name: parsed.name, args: parsed.args };
  } catch {
    return undefined;
  }
}

function balancedJsonObject(text: string, start: number): string | undefined {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
