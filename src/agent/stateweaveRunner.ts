import { applyOps, addToolResult } from "../core/applyOps.js";
import { appendInputToGraphFrame, cloneFrame, createInitialGraphFrame } from "../core/graph.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import { serializeGraphFrame } from "../core/serialize.js";
import type { AgentResult, GraphFrame, GraphOp, StateWeaveRunMetadata, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";

export type StateWeaveInput = TaskInput;
export type StateWeaveRunOptions = { frame?: GraphFrame; inputAlreadyAppended?: boolean };
export type StateWeaveRunnerArgs = { model: Model; tools: Tool[]; maxIterations?: number; systemPrompt?: string; nodeTypes?: string[] };

export class StateWeaveRunError extends Error {
  trace: TraceStep[];
  metadata: StateWeaveRunMetadata;

  constructor(message: string, trace: TraceStep[], metadata: StateWeaveRunMetadata) {
    super(message);
    this.name = "StateWeaveRunError";
    this.trace = trace;
    this.metadata = metadata;
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
    ? options.inputAlreadyAppended
      ? cloneFrame(options.frame)
      : appendInputToGraphFrame(options.frame, task)
    : createInitialGraphFrame({
        objective: task.objective,
        input: task.input,
        systemPrompt: args.systemPrompt,
        availableActions: [...tools.values()].map((tool) => `tool:${tool.name} - ${tool.description}`),
        nodeTypes: args.nodeTypes
      });
  const trace: TraceStep[] = [];
  const maxIterations = args.maxIterations ?? 30;
  const runId = runIdForNow();
  const startedAt = new Date();
  let retryCount = 0;
  let finalAnswer = "";
  const toolInfo = [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description }));

  yield { type: "metadata", metadata: runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "running") };

  for (let step = 1; step <= maxIterations; step++) {
    const stepStartedAt = new Date();
    const frameBefore = cloneFrame(frame);
    const prompt = serializeGraphFrame(frameBefore);
    const streamedTokens: string[] = [];
    const modelMetadata: Record<string, unknown>[] = [];

    yield { type: "frame", step, phase: "before", frame: frameBefore, prompt, tokenEstimate: estimateStateWeaveTokens(prompt) };
    for await (const event of args.model.stream({ prompt, frame: frameBefore, mode: "graph_ops" })) {
      if (event.type === "metadata") {
        modelMetadata.push(event.metadata);
        yield { type: "model_metadata", step, metadata: event.metadata };
        continue;
      }
      streamedTokens.push(event.token);
      yield { type: "token", step, token: event.token };
    }

    const rawModelOutput = streamedTokens.join("");
    let parsedOps: GraphOp[] = [];
    try {
      parsedOps = parseAndValidateOps(rawModelOutput);
      frame = await applyAndRunTools(frame, parsedOps, tools, step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const frameAfter = cloneFrame(frame);
      trace.push(traceStep({ step, startedAt: stepStartedAt, frameBefore, prompt, streamedTokens, modelMetadata, rawModelOutput, parsedOps, frameAfter, error: message }));
      const retryable = step < maxIterations;
      yield { type: "error", step, message, retryable };
      if (!retryable) throw new StateWeaveRunError(`StateWeave GraphOps failed after ${step} step(s): ${message}`, trace, runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "error"));
      retryCount += 1;
      frame = retryFrameAfterGraphOpsError(frame, message);
      continue;
    }

    const final = parsedOps.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
    if (final) finalAnswer = final.answer;

    const frameAfter = cloneFrame(frame);
    trace.push(traceStep({ step, startedAt: stepStartedAt, frameBefore, prompt, streamedTokens, modelMetadata, rawModelOutput, parsedOps, frameAfter }));
    yield { type: "ops", step, ops: parsedOps };
    yield { type: "frame", step, phase: "after", frame: frameAfter };
    if (finalAnswer) break;
  }

  if (!finalAnswer) {
    throw new StateWeaveRunError(
      `Recursion limit reached after ${maxIterations} iteration(s); consider increasing maxIterations.`,
      trace,
      runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "error")
    );
  }
  yield { type: "final", result: { finalAnswer, frame, graph: frame.graph, trace, metadata: runMetadata(runId, toolInfo, startedAt, maxIterations, trace, retryCount, "done") } };
}

function traceStep(args: {
  step: number;
  startedAt: Date;
  frameBefore: GraphFrame;
  prompt: string;
  streamedTokens: string[];
  modelMetadata: Record<string, unknown>[];
  rawModelOutput: string;
  parsedOps: GraphOp[];
  frameAfter: GraphFrame;
  error?: string;
}): TraceStep {
  const completedAt = new Date();
  return {
    step: args.step,
    startedAt: args.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - args.startedAt.getTime(),
    frameBefore: args.frameBefore,
    prompt: args.prompt,
    tokenEstimate: estimateStateWeaveTokens(args.prompt),
    streamedTokens: args.streamedTokens,
    ...(args.modelMetadata.length ? { modelMetadata: args.modelMetadata } : {}),
    rawModelOutput: args.rawModelOutput,
    parsedOps: args.parsedOps,
    frameAfter: args.frameAfter,
    ...(args.error ? { error: args.error } : {})
  };
}

function runMetadata(
  runId: string,
  tools: StateWeaveRunMetadata["tools"],
  startedAt: Date,
  maxIterations: number,
  trace: TraceStep[],
  retryCount: number,
  status: StateWeaveRunMetadata["status"]
): StateWeaveRunMetadata {
  const completedAt = status === "running" ? undefined : new Date();
  return {
    runId,
    tools,
    startedAt: startedAt.toISOString(),
    ...(completedAt ? { completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - startedAt.getTime() } : {}),
    maxIterations,
    stepCount: trace.length,
    retryCount,
    status
  };
}

function runIdForNow(): string {
  return `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function retryFrameAfterGraphOpsError(frame: GraphFrame, message: string): GraphFrame {
  const next = cloneFrame(frame);
  const latest = next.frame.latestInputNodeId ?? next.frame.activeUserInputNodeId ?? "the latest user_input";
  next.frame.lastGraphOpsError = message;
  next.frame.currentFocus = `Previous GraphOps transaction was rejected: ${message}`;
  next.frame.nextExpectedOutput = `Retry the complete SWX/1 transaction. First attach ${latest} to system_root for a fresh request or to the relevant existing node, then attach every new semantic/output node with @edge before returning @final "human-readable answer" or @final_ref final_answer.`;
  return next;
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
