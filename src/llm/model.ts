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
  signal?: AbortSignal;
};

export type ModelToken = {
  type: "token";
  token: string;
};

export type ModelOutput = {
  text: string;
};

export type Model = {
  complete(input: ModelInput): Promise<ModelOutput>;
  stream(input: ModelInput): AsyncIterable<ModelToken>;
};

export async function collectModelText(stream: AsyncIterable<ModelToken>): Promise<{ text: string; tokens: string[] }> {
  const tokens: string[] = [];
  for await (const event of stream) tokens.push(event.token);
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
    const lower = source.toLowerCase();
    const identity = identityOutput(source);
    if (identity && input.mode === "text") return identity.answer;
    if (identity && input.mode !== "text") return JSON.stringify(identity.ops);

    const task = inferTask(lower);
    const hasToolResult = input.frame?.graph.nodes.some((node) => node.type === "tool_result") ?? input.prompt.toLowerCase().includes("tool_result");
    if (input.mode === "text") return finalFor(task);

    if (!hasToolResult) {
      return JSON.stringify({
        ops: [
          {
            op: "add_node",
            node: {
              id: `hypothesis_${task}`,
              type: "hypothesis",
              text: hypothesisFor(task),
              confidence: 0.72,
              status: "active"
            }
          },
          { op: "call_tool", tool: toolFor(task), args: argsFor(task) }
        ]
      });
    }

    return JSON.stringify({
      ops: [
        {
          op: "add_node",
          node: {
            id: `decision_${task}`,
            type: "decision",
            text: finalFor(task),
            confidence: 0.86,
            status: "resolved"
          }
        },
        { op: "final", answer: finalFor(task) }
      ]
    });
  }
}

function identityOutput(source: string): { answer: string; ops: { ops: unknown[] } } | undefined {
  const name = source.match(/my name is\s+([a-z][a-z0-9_-]*)/i)?.[1];
  const asksName = /what(?:'| i)?s my name|what is my name/i.test(source);
  if (!name) return undefined;

  const answer = asksName ? `Your name is ${name}.` : `Nice to meet you, ${name}.`;
  return {
    answer,
    ops: {
      ops: [
        { op: "add_node", node: { id: "fact_user_name", type: "fact", text: `The user's name is ${name}.`, confidence: 1, status: "active" } },
        { op: "final", answer }
      ]
    }
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
