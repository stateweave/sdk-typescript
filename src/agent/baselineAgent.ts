import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import type { AgentResult } from "../core/types.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";
import { toolMap } from "../tools/mockTools.js";

export type TraditionalMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type TraditionalMessagesResult = {
  messages: TraditionalMessage[];
  rawModelInput: string;
  rawModelOutput: string;
  finalAnswer: string;
  tokenEstimate: { estimatedTokens: number; messageCount: number };
};

export class TraditionalMessagesAgent {
  private model: Model;
  private tools: Map<string, Tool>;

  constructor(args: { model: Model; tools: Tool[] }) {
    this.model = args.model;
    this.tools = toolMap(args.tools);
  }

  async inspect(input: TaskInput): Promise<TraditionalMessagesResult> {
    const task = normalizeTaskInput(input);
    const toolResult = await this.maybeCallTool(`${task.objective}\n${task.input}`);
    const messages: TraditionalMessage[] = [
      { role: "system", content: "You are a coding agent. Be concise. Use available tool observations if provided." },
      { role: "user", content: task.input }
    ];
    if (toolResult) messages.push({ role: "tool", content: String(toolResult) });

    const rawModelInput = serializeMessages(messages);
    const { text } = await this.model.complete({ prompt: rawModelInput, mode: "text", frame: emptyFrame(task.objective) });
    return {
      messages,
      rawModelInput,
      rawModelOutput: text,
      finalAnswer: text,
      tokenEstimate: { ...estimateStateWeaveTokens(rawModelInput), messageCount: messages.length }
    };
  }

  async run(input: TaskInput): Promise<AgentResult> {
    const startedAt = new Date();
    const task = normalizeTaskInput(input);
    const result = await this.inspect(task);
    const completedAt = new Date();
    const frame = emptyFrame(task.objective);
    return {
      finalAnswer: result.finalAnswer,
      frame,
      graph: frame.graph,
      trace: [
        {
          step: 1,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          frameBefore: frame,
          prompt: result.rawModelInput,
          tokenEstimate: result.tokenEstimate,
          streamedTokens: [result.rawModelOutput],
          rawModelOutput: result.rawModelOutput,
          parsedOps: [],
          frameAfter: frame
        }
      ],
      metadata: {
        runId: `baseline_${Date.now().toString(36)}`,
        tools: [],
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        maxIterations: 1,
        stepCount: 1,
        retryCount: 0,
        status: "done"
      }
    };
  }

  private async maybeCallTool(task: string): Promise<unknown> {
    const lower = task.toLowerCase();
    if (lower.includes("payment")) return this.tools.get("run_mock_tests")?.execute({ pattern: "payment" });
    if (lower.includes("api") || lower.includes("shape")) return this.tools.get("search_mock_codebase")?.execute({ query: "api response shape" });
    if (lower.includes("login") || lower.includes("refresh")) return this.tools.get("read_mock_file")?.execute({ path: "auth.ts" });
    return undefined;
  }
}

export class BaselineAgent extends TraditionalMessagesAgent {}

function serializeMessages(messages: TraditionalMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function emptyFrame(objective: string) {
  return {
    frame: {
      objective,
      currentFocus: "traditional messages baseline",
      nextExpectedOutput: "assistant text",
      activeConstraints: [],
      availableActions: []
    },
    graph: { nodes: [], edges: [] }
  };
}
