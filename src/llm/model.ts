import type { GraphFrame } from "../core/types.js";

export type ModelMode = "graph_ops" | "text";

export type ModelParameters = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
};

export type ModelInput = {
  prompt: string;
  frame?: GraphFrame;
  mode?: ModelMode;
  parameters?: ModelParameters;
  system?: string;
  signal?: AbortSignal;
};

export type ModelStreamMetadata = Record<string, unknown>;

export type ModelToken =
  | {
      type: "token";
      token: string;
    }
  | {
      type: "metadata";
      metadata: ModelStreamMetadata;
    };

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  uncachedInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type ModelOutput = {
  text: string;
  usage?: ModelUsage;
};

export type Model = {
  complete(input: ModelInput): Promise<ModelOutput>;
  stream(input: ModelInput): AsyncIterable<ModelToken>;
};

export async function collectModelText(stream: AsyncIterable<ModelToken>): Promise<{ text: string; tokens: string[] }> {
  const tokens: string[] = [];
  for await (const event of stream) {
    if (event.type === "token") tokens.push(event.token);
  }
  return { text: tokens.join(""), tokens };
}

export class MockModel implements Model {
  async complete(input: ModelInput): Promise<ModelOutput> {
    return { text: this.output(input) };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    for (const token of chunkText(this.output(input))) {
      yield { type: "token", token };
    }
  }

  private output(input: ModelInput): string {
    const source = input.frame ? frameText(input.frame) : input.prompt;
    const inputNodeId = input.frame?.frame.latestInputNodeId ?? "user_input_1";
    const lower = source.toLowerCase();
    if (lower.includes("evaluate a blind a/b answer comparison")) return mockJudge(source);
    const identity = identityOutput(source, inputNodeId);
    const task = inferTask(lower);
    if (input.prompt.startsWith("CAUSAL_WEAVE/1") || input.prompt.startsWith("MOLECULAR_WEAVE/1")) return `FINAL: ${identity?.answer ?? finalFor(task)}`;
    if (input.mode === "text" && input.prompt.startsWith("SYSTEM:") && input.prompt.includes("transcript is your complete working memory")) return `FINAL: ${identity?.answer ?? finalFor(task)}`;
    if (identity && input.mode === "text") return identity.answer;
    if (identity && input.mode !== "text") return identity.swx;

    const hasToolResult = input.frame?.graph.nodes.some((node) => node.type === "tool_result") ?? input.prompt.toLowerCase().includes("tool_result");
    if (input.mode === "text") return finalFor(task);

    if (!hasToolResult && source.includes(`tool:${toolFor(task)}`)) {
      return [
        "SWX/1",
        `@edge system_root follows ${inputNodeId}`,
        `@node hypothesis_${task} hypothesis "${hypothesisFor(task)}" confidence=0.72 status=active`,
        `@edge ${inputNodeId} supports hypothesis_${task}`,
        `@tool ${toolFor(task)} ${argsForSwx(task)}`
      ].join("\n");
    }

    return [
      "SWX/1",
      `@edge system_root follows ${inputNodeId}`,
      `@node decision_${task} decision "${finalFor(task)}" confidence=0.86 status=resolved`,
      `@edge ${inputNodeId} supports decision_${task}`,
      `@final "${finalFor(task)}"`
    ].join("\n");
  }
}

function mockJudge(source: string): string {
  const gold = source.match(/GOLD ANSWER:\n([\s\S]*?)\n\nANSWER A:/)?.[1]?.trim().toLowerCase() ?? "";
  const answerA = source.match(/ANSWER A:\n([\s\S]*?)\n\nANSWER B:/)?.[1]?.trim().toLowerCase() ?? "";
  const answerB = source.match(/ANSWER B:\n([\s\S]*?)\n\nReturn exactly:/)?.[1]?.trim().toLowerCase() ?? "";
  const a = Boolean(gold && answerA.includes(gold));
  const b = Boolean(gold && answerB.includes(gold));
  const winner = a && b ? "BOTH" : a ? "A" : b ? "B" : "NEITHER";
  return `WINNER: ${winner}\nREASON: Mock judge compared answers to the gold string.`;
}

function identityOutput(source: string, inputNodeId: string): { answer: string; swx: string } | undefined {
  const name = source.match(/my name is\s+([a-z][a-z0-9_-]*)/i)?.[1];
  const asksName = /what(?:'| i)?s my name|what is my name/i.test(source);
  if (!name) return undefined;

  const answer = asksName ? `Your name is ${name}.` : `Nice to meet you, ${name}.`;
  return {
    answer,
    swx: [
      "SWX/1",
      `@edge system_root follows ${inputNodeId}`,
      `@node fact_user_name fact "The user's name is ${name}." confidence=1 status=active`,
      `@edge ${inputNodeId} supports fact_user_name`,
      `@final "${answer}"`
    ].join("\n")
  };
}

function frameText(frame: NonNullable<ModelInput["frame"]>): string {
  return [frame.frame.objective, ...frame.graph.nodes.map((node) => node.text)].join("\n");
}

function inferTask(text: string): "login" | "payment" | "api" {
  if (text.includes("payment")) return "payment";
  if (text.includes("api") || text.includes("shape") || text.includes("response")) return "api";
  return "login";
}

function toolFor(task: "login" | "payment" | "api"): string {
  if (task === "payment") return "run_mock_tests";
  if (task === "api") return "search_mock_codebase";
  return "read_mock_file";
}

function argsFor(task: "login" | "payment" | "api"): Record<string, unknown> {
  if (task === "payment") return { pattern: "payment" };
  if (task === "api") return { query: "api response shape" };
  return { path: "auth.ts" };
}

function argsForSwx(task: "login" | "payment" | "api"): string {
  return Object.entries(argsFor(task)).map(([key, value]) => `${key}="${String(value)}"`).join(" ");
}

function hypothesisFor(task: "login" | "payment" | "api"): string {
  if (task === "payment") return "The failing payment test may be caused by cents/dollars normalization or tax rounding drift.";
  if (task === "api") return "The API response mismatch may be caused by returning snake_case where the client expects camelCase.";
  return "The login bug may come from refresh token handling before session persistence.";
}

function finalFor(task: "login" | "payment" | "api"): string {
  if (task === "payment") {
    return "The payment test is failing because the mock checkout total mixes dollars and cents, causing tax rounding drift. Fix normalization at the boundary; do not rewrite payments.";
  }
  if (task === "api") {
    return "The API response shape mismatch comes from the handler returning snake_case user_id while the client expects camelCase userId. Add a response mapper or adjust the contract in one place.";
  }
  return "The login failure is likely because refresh token handling happens before the session is saved, so the refreshed token can be cleared before persistence. Move persistence before clearing/rotating the refresh token; do not rewrite the auth system.";
}

function chunkText(text: string, size = 24): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
}
