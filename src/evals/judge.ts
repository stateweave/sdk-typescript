import type { GraphFrameRunResult } from "../core/types.js";
import type { EvalTask } from "./tasks.js";

export type EvalScore = {
  success: boolean;
  matchedFacts: string[];
  calledTool: boolean;
  avoidedForbiddenRewrite: boolean;
  notes: string;
};

export function judge(task: EvalTask, result: GraphFrameRunResult): EvalScore {
  const text = `${result.finalAnswer}\n${JSON.stringify(result.graph)}`.toLowerCase();
  const traceText = JSON.stringify(result.trace).toLowerCase();
  const matchedFacts = task.expectedFacts.filter((fact) => text.includes(fact.toLowerCase()));
  const calledTool = result.trace.some((step) => step.parsedOps.some((op) => op.op === "call_tool")) || text.includes("tool_result") || traceText.includes("role: tool") || traceText.includes('"role":"tool"') || traceText.includes("tool:");
  const avoidedForbiddenRewrite = !/rewrite (the )?(auth system|payments|api)/i.test(result.finalAnswer) || /\b(do not|not|without) rewrite/i.test(result.finalAnswer);
  const success = matchedFacts.length >= Math.min(2, task.expectedFacts.length) && avoidedForbiddenRewrite;
  return {
    success,
    matchedFacts,
    calledTool,
    avoidedForbiddenRewrite,
    notes: `facts=${matchedFacts.join(",") || "none"}; tool=${calledTool ? "yes" : "no"}`
  };
}
