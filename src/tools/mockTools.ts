import { z } from "zod";
import type { Tool } from "./types.js";

export const mockTools: Tool[] = [
  {
    name: "read_mock_file",
    description: "Read a deterministic fake file summary. Use path auth.ts for login refresh/token issues.",
    schema: z.object({ path: z.string() }),
    async execute(args: unknown) {
      const { path } = z.object({ path: z.string() }).parse(args);
      if (path === "auth.ts") {
        return "auth.ts summary: refresh token is rotated/cleared before session save completes; login after refresh can lose the new token.";
      }
      return `${path} summary: no relevant issue found.`;
    }
  },
  {
    name: "run_mock_tests",
    description: "Run deterministic fake test output. Use for payment checkout failures.",
    schema: z.object({ pattern: z.string().optional() }),
    async execute() {
      return "payment.test.ts failed: expected totalCents=1299 but received 12.99; dollars/cents normalization and tax rounding are mixed.";
    }
  },
  {
    name: "search_mock_codebase",
    description: "Search deterministic fake codebase snippets. Use for API response shape mismatches or broad code search.",
    schema: z.object({ query: z.string() }),
    async execute(args: unknown) {
      const { query } = z.object({ query: z.string() }).parse(args);
      const lower = query.toLowerCase();
      if (lower.includes("login") || lower.includes("refresh") || lower.includes("token") || lower.includes("auth")) {
        return "Search results: auth.ts refresh flow rotates/clears the refresh token before session save completes; persistence can lose the refreshed token.";
      }
      return "Search results: api/user.ts returns { user_id, display_name }; web client expects { userId, displayName }.";
    }
  }
];

export function toolMap(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}
