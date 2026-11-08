import { z } from "zod";
import { edgeTypes, type GraphOp } from "./types.js";
import { isSw2, parseSw2 } from "./sw2.js";
import { parseSwx } from "./swxLegacy.js";

export const nodeTypeSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const edgeTypeSchema = z.enum(edgeTypes);

const statusSchema = z.enum(["active", "resolved", "rejected", "stale"]);

export const graphNodeWithoutCreatedAtSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  text: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: statusSchema.optional()
});

export const graphOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: graphNodeWithoutCreatedAtSchema }),
  z.object({ op: z.literal("add_edge"), from: z.string().min(1), to: z.string().min(1), type: edgeTypeSchema }),
  z.object({ op: z.literal("update_node"), id: z.string().min(1), patch: graphNodeWithoutCreatedAtSchema.partial().extend({ createdAt: z.string().optional() }) }),
  z.object({ op: z.literal("focus"), currentFocus: z.string().min(1), nodeId: z.string().min(1).optional() }),
  z.object({ op: z.literal("zoom"), level: z.number().int().min(0).max(10) }),
  z.object({ op: z.literal("call_tool"), tool: z.string().min(1), args: z.record(z.unknown()) }),
  z.object({ op: z.literal("spawn_worker"), id: z.string().min(1), objective: z.string().min(1), focusNodeId: z.string().min(1).optional(), input: z.string().min(1).optional(), maxIterations: z.number().int().min(1).optional() }),
  z.object({ op: z.literal("final"), answer: z.string().min(1), artifactId: z.string().min(1).optional(), artifactIds: z.array(z.string().min(1)).optional(), outcome: z.literal("already_satisfied").optional() })
]);

export const graphOpsResponseSchema = z.object({ ops: z.array(graphOpSchema).min(1) });

/** Parses model output: SW2 (current), SWX/1 (compatibility), or legacy JSON `{ ops: [...] }`. */
export function parseAndValidateOps(raw: string): GraphOp[] {
  if (isSw2(raw)) return graphOpsResponseSchema.parse({ ops: parseSw2(raw) }).ops;
  const text = stripFence(raw.trim());
  const swxStart = text.search(/^[\t ]*SWX\/1[\t ]*\r?$/m);
  if (swxStart >= 0) {
    const ops = parseSwx(text.slice(swxStart));
    if (!ops.length) throw new Error("Model returned SWX/1 but no graph operations were found.");
    return graphOpsResponseSchema.parse({ ops }).ops;
  }
  try {
    return graphOpsResponseSchema.parse(JSON.parse(extractJsonObject(text)) as unknown).ops;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Model returned invalid StateWeave exchange. Expected a first line of SW2; legacy JSON parse failed: ${error.message}`);
    throw error;
  }
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start > 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function stripFence(raw: string): string {
  return raw.match(/^```(?:swx|stateweave|text)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? raw;
}
