import { applyOps, addToolResult } from "../core/applyOps.js";
import { appendInputToGraphFrame, cloneFrame, createInitialGraphFrame } from "../core/graph.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import { serializeGraphFrame } from "../core/serialize.js";
import type { AgentResult, GraphFrame, GraphOp, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";

export type StateWeaveInput = TaskInput;
export type StateWeaveRunOptions = { frame?: GraphFrame };
export type StateWeaveRunnerArgs = { model: Model; tools: Tool[]; maxSteps?: number };

export class StateWeaveRunError extends Error {
  trace: TraceStep[];

  constructor(message: string, trace: TraceStep[]) {
    super(message);
    this.name = "StateWeaveRunError";
    this.trace = trace;
  }
}

export async function runStateWeave(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
  let result: AgentResult | undefined;
  for await (const event of streamStateWeave(args, input, options)) {
    if (event.type === "final") result = event.result;
  }
  if (!result) throw new Error("StateWeave stream ended without a final result.");
  return result;
}

export async function* streamStateWeave(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
  const tools = new Map(args.tools.map((tool) => [tool.name, tool]));
  const task = normalizeTaskInput(input);
  let frame = options?.frame
    ? appendInputToGraphFrame(options.frame, task)
    : createInitialGraphFrame({
        objective: task.objective,
        input: task.input,
        availableActions: [...tools.values()].map((tool) => `tool:${tool.name} - ${tool.description}`)
      });
  const trace: TraceStep[] = [];
  let finalAnswer = "";

  for (let step = 1; step <= (args.maxSteps ?? 5); step++) {
    const frameBefore = cloneFrame(frame);
    const prompt = serializeGraphFrame(frameBefore);
    const streamedTokens: string[] = [];

    yield { type: "frame", step, phase: "before", frame: frameBefore };
    for await (const event of args.model.stream({ prompt, frame: frameBefore, mode: "graph_ops" })) {
      streamedTokens.push(event.token);
      yield { type: "token", step, token: event.token };
    }

    const rawModelOutput = streamedTokens.join("");
    let parsedOps: GraphOp[];
    try {
      parsedOps = parseAndValidateOps(rawModelOutput);
      frame = await applyAndRunTools(frame, parsedOps, tools, step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const frameAfter = cloneFrame(frame);
      trace.push({ step, frameBefore, prompt, tokenEstimate: estimateStateWeaveTokens(prompt), streamedTokens, rawModelOutput, parsedOps: [], frameAfter, error: message });
      throw new StateWeaveRunError(message, trace);
    }

    const final = parsedOps.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
    if (final) finalAnswer = final.answer;

    const frameAfter = cloneFrame(frame);
    trace.push({ step, frameBefore, prompt, tokenEstimate: estimateStateWeaveTokens(prompt), streamedTokens, rawModelOutput, parsedOps, frameAfter });
    yield { type: "ops", step, ops: parsedOps };
    yield { type: "frame", step, phase: "after", frame: frameAfter };
    if (finalAnswer) break;
  }

  if (!finalAnswer) finalAnswer = "No final answer produced before maxSteps.";
  yield { type: "final", result: { finalAnswer, graph: frame.graph, trace } };
}

async function applyAndRunTools(frame: GraphFrame, ops: GraphOp[], tools: Map<string, Tool>, step: number): Promise<GraphFrame> {
  let next = applyOps(frame, ops);
  for (const op of ops) {
    if (op.op !== "call_tool") continue;
    const tool = tools.get(op.tool);
    if (!tool) throw new Error(`Unknown tool: ${op.tool}`);
    const parsedArgs = tool.schema.parse(op.args);
    const result = await tool.execute(parsedArgs);
    next = { ...next, graph: addToolResult(next.graph, { tool: op.tool, result, step }) };
    next.frame.currentFocus = `Use ${op.tool} result to decide the next graph mutation or final answer.`;
  }
  return next;
}
