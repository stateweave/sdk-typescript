import { z } from "zod";
import type { GraphOp } from "./types.js";

export const nodeTypeSchema = z.enum([
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
  z.object({ op: z.literal("focus"), currentFocus: z.string().min(1) }),
  z.object({ op: z.literal("call_tool"), tool: z.string().min(1), args: z.record(z.unknown()) }),
  z.object({ op: z.literal("final"), answer: z.string().min(1) })
]);

export const graphOpsResponseSchema = z.object({ ops: z.array(graphOpSchema).min(1) });

export function parseAndValidateOps(raw: string): GraphOp[] {
  const parsed = JSON.parse(extractJsonObject(raw)) as unknown;
  return graphOpsResponseSchema.parse(parsed).ops;
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
