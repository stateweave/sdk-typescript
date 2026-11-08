import { applyOps, addToolResult } from "../core/applyOps.js";
import { appendInputToGraphFrame, assertValidGraphFrame, cloneFrame, createInitialGraphFrame, forkFrameMetadataOnly } from "../core/graph.js";
import { turnTask } from "../core/graphEdit.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import { serializeGraphFrame } from "../core/serialize.js";
import { sw2Forms } from "../core/sw2.js";
import type { GraphFrame, GraphFrameRunResult, GraphOp, StateWeaveRunMetadata, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";
import { runWorkers, workerOps } from "./graphWorkers.js";
import { detectIntent, newEvidence, recordSignals, safeToolArgs, signalsFor, toolExecutionSucceeded, toolFailureMessage, validateEditEvidence, validateFinalEvidence, validateToolTransaction, type Evidence, type Intent, type ToolSignals } from "./runEvidence.js";

export type StateWeaveInput = TaskInput;
export type StateWeaveRunOptions = { frame?: GraphFrame; inputAlreadyAppended?: boolean; signal?: AbortSignal };
export type StateWeaveRunnerArgs = { model: Model; tools: Tool[]; maxIterations?: number; maxNoProgressIterations?: number; maxPromptTokens?: number; systemPrompt?: string; nodeTypes?: string[]; traceMode?: "full" | "compact"; blindIdentity?: boolean; providerSystem?: string };

export class StateWeaveRunError extends Error {
  trace: TraceStep[];
  metadata: StateWeaveRunMetadata;
  frame?: GraphFrame;

  constructor(message: string, trace: TraceStep[], metadata: StateWeaveRunMetadata, frame?: GraphFrame) {
    super(message);
    this.name = "StateWeaveRunError";
    this.trace = trace;
    this.metadata = metadata;
    this.frame = frame ? cloneFrame(frame) : undefined;
  }
}

type CallTool = Extract<GraphOp, { op: "call_tool" }>;

type Run = {
  args: StateWeaveRunnerArgs;
  tools: Map<string, Tool>;
  signal?: AbortSignal;
  frame: GraphFrame;
  trace: TraceStep[];
  intent: Intent;
  evidence: Evidence;
  meta: { runId: string; tools: StateWeaveRunMetadata["tools"]; startedAt: Date; maxIterations: number; maxPromptTokens: number; retryCount: number };
};

type ModelTurn = { step: number; startedAt: Date; frameBefore: GraphFrame; prompt: string; streamedTokens: string[]; modelMetadata: Record<string, unknown>[] };

export async function runStateWeave(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<GraphFrameRunResult> {
  let result: GraphFrameRunResult | undefined;
  for await (const event of streamStateWeave(args, input, options)) {
    if (event.type === "final") result = event.result;
  }
  if (!result) throw new Error("StateWeave stream ended without a final result.");
  return result;
}

export async function* streamStateWeave(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
  const run = startRun(args, input, options);
  options?.signal?.throwIfAborted();
  yield { type: "metadata", metadata: runMetadata(run, "running") };
  for (let step = 1; step <= run.meta.maxIterations; step++) {
    options?.signal?.throwIfAborted();
    const finalAnswer = yield* runStep(run, step);
    if (finalAnswer) {
      yield { type: "final", result: { finalAnswer, frame: run.frame, graph: run.frame.graph, trace: run.trace, metadata: runMetadata(run, "done") } };
      return;
    }
    const stall = args.maxNoProgressIterations;
    if (stall && step - run.evidence.lastMutationStep >= stall) {
      throw runError(run, `No successful workspace mutation occurred in ${stall} consecutive model iterations; stopping the non-convergent run with its frame and trace preserved.`);
    }
  }
  throw runError(run, `Recursion limit reached after ${run.meta.maxIterations} iteration(s); consider increasing maxIterations.`);
}

function startRun(args: StateWeaveRunnerArgs, input: StateWeaveInput, options?: StateWeaveRunOptions): Run {
  const tools = new Map(args.tools.map((tool) => [tool.name, tool]));
  const task = normalizeTaskInput(input);
  const frame = options?.frame
    ? options.inputAlreadyAppended ? cloneFrame(options.frame) : appendInputToGraphFrame(options.frame, task)
    : createInitialGraphFrame({ objective: task.objective, input: task.input, systemPrompt: args.systemPrompt, availableActions: [...tools.values()].map((tool) => `tool:${tool.name} - ${tool.description}`), nodeTypes: args.nodeTypes });
  assertValidGraphFrame(frame);
  return {
    args,
    tools,
    signal: options?.signal,
    frame,
    trace: [],
    intent: detectIntent(`${task.objective}\n${task.input}`),
    evidence: newEvidence(),
    meta: {
      runId: `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      tools: args.tools.map((tool) => ({ name: tool.name, description: tool.description })),
      startedAt: new Date(),
      maxIterations: args.maxIterations ?? 30,
      maxPromptTokens: args.maxPromptTokens ?? 64_000,
      retryCount: 0
    }
  };
}

/** One model turn: prompt → stream → validate → apply/execute. Returns the final answer, if any. */
async function* runStep(run: Run, step: number): AsyncGenerator<StateWeaveStreamEvent, string | undefined> {
  const turn: ModelTurn = { step, startedAt: new Date(), frameBefore: run.frame, prompt: serializeGraphFrame(run.frame, { blindIdentity: run.args.blindIdentity, maxTokens: run.meta.maxPromptTokens }), streamedTokens: [], modelMetadata: [] };
  yield { type: "frame", step, phase: "before", frame: turn.frameBefore, prompt: turn.prompt, tokenEstimate: estimateStateWeaveTokens(turn.prompt) };
  yield* streamModel(run, turn);
  let parsedOps: GraphOp[] = [];
  try {
    parsedOps = parseAndValidateOps(turn.streamedTokens.join(""));
    yield* commitOps(run, parsedOps, step);
  } catch (error) {
    if (run.signal?.aborted) throw run.signal.reason;
    const message = error instanceof Error ? error.message : String(error);
    run.trace.push(traceStep(run, turn, parsedOps, message));
    const retryable = step < run.meta.maxIterations;
    yield { type: "error", step, message, retryable };
    if (!retryable) throw runError(run, `StateWeave GraphOps failed after ${step} step(s): ${message}`);
    run.meta.retryCount += 1;
    run.frame = retryFrame(run.frame, message);
    return undefined;
  }
  run.trace.push(traceStep(run, turn, parsedOps));
  yield { type: "frame", step, phase: "after", frame: run.frame };
  return parsedOps.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final")?.answer || undefined;
}

async function* streamModel(run: Run, turn: ModelTurn): AsyncGenerator<StateWeaveStreamEvent> {
  for await (const event of run.args.model.stream({ prompt: turn.prompt, frame: turn.frameBefore, mode: "graph_ops", signal: run.signal, system: run.args.providerSystem })) {
    if (event.type === "metadata") {
      turn.modelMetadata.push(event.metadata);
      yield { type: "model_metadata", step: turn.step, metadata: event.metadata };
    } else {
      turn.streamedTokens.push(event.token);
      yield { type: "token", step: turn.step, token: event.token };
    }
  }
}

async function* commitOps(run: Run, ops: GraphOp[], step: number): AsyncGenerator<StateWeaveStreamEvent> {
  validateToolTransaction(ops);
  validateEditEvidence(ops, run.frame.graph);
  const candidate = applyOps(run.frame, ops);
  validateFinalEvidence(ops, run.intent, run.evidence);
  yield { type: "ops", step, ops };
  const call = ops.find((op): op is CallTool => op.op === "call_tool");
  if (call) {
    const outcome = await executeTool(run, run.frame, candidate, call, step);
    run.signal?.throwIfAborted();
    run.frame = outcome.frame;
    if (outcome.signals) recordSignals(run.evidence, outcome.signals, step);
  } else {
    run.frame = candidate;
  }
  const spawns = workerOps(ops);
  if (spawns.length) {
    const worker = (objective: string, input: string, frame: GraphFrame, maxIterations: number | undefined) =>
      streamStateWeave({ ...run.args, maxIterations: maxIterations ?? run.meta.maxIterations }, { objective, input }, { frame, inputAlreadyAppended: true, signal: run.signal });
    run.frame = yield* runWorkers(run.frame, spawns, step, worker, run.signal);
  }
}

/** Executes the tool. Success commits the candidate ops plus evidence; failure records rejected evidence only. */
async function executeTool(run: Run, original: GraphFrame, candidate: GraphFrame, op: CallTool, step: number): Promise<{ frame: GraphFrame; signals?: ToolSignals }> {
  const tool = run.tools.get(op.tool);
  if (!tool) throw new Error(`Unknown tool: ${op.tool}. ${sw2Forms.T}`);
  const parsedArgs = tool.schema.parse(op.args);
  let result: unknown;
  try {
    result = await tool.execute(parsedArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { frame: failedTool(original, op, { ok: false, error: message, tool: op.tool, args: safeToolArgs(op.args) }, step, message) };
  }
  if (!toolExecutionSucceeded(op.tool, result)) return { frame: failedTool(original, op, result, step, toolFailureMessage(op.tool, result)) };
  const signals = signalsFor(op, result);
  const anchorId = turnTask(candidate.graph, inputId(candidate))?.id;
  const next = { ...candidate, graph: addToolResult(candidate.graph, { tool: op.tool, toolArgs: op.args, result, step, ok: true, anchorId }) };
  next.frame.currentFocus = `${op.tool} ok; read its tool_result.`;
  next.frame.nextExpectedOutput = signals.mutation ? "Verify the change if asked, then F from evidence." : "Next T, or F from evidence.";
  return { frame: next, signals };
}

function failedTool(original: GraphFrame, op: CallTool, result: unknown, step: number, message: string): GraphFrame {
  const next = forkFrameMetadataOnly(original);
  next.graph = addToolResult(next.graph, { tool: op.tool, toolArgs: op.args, result, step, ok: false, anchorId: turnTask(original.graph, inputId(original))?.id });
  next.frame.lastGraphOpsError = `Tool ${op.tool} failed: ${message}`;
  next.frame.currentFocus = `${op.tool} failed; its other ops were not committed.`;
  next.frame.nextExpectedOutput = "Fix the cause shown in the rejected tool_result (re-read stale files), then one corrected T. Never claim success.";
  return next;
}

function inputId(frame: GraphFrame): string | undefined {
  return frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId;
}

function retryFrame(frame: GraphFrame, message: string): GraphFrame {
  const next = forkFrameMetadataOnly(frame);
  next.frame.lastGraphOpsError = message;
  next.frame.currentFocus = "Previous transaction was rejected; see error.";
  next.frame.nextExpectedOutput = recoveryInstruction(message);
  return next;
}

const recoveries: [RegExp, string][] = [
  [/^SW2 line|Invalid SWX|Unknown SWX/i, "Fix the rejected line to the expected form in the error; never resend it unchanged."],
  [/needs current evidence/i, "T read_file path=<path>, then retry the edit (or pass expected_hash=<content_hash>)."],
  [/restart/i, "T app_control action=restart, read the result, then F."],
  [/smoke/i, "T app_control action=smoke (or action=restart when restart is also required), then F from evidence."],
  [/checks?\/tests?|action=check/i, "T app_control action=check (or a permitted bash check), then F from evidence."],
  [/verification/i, "Run the requested verification as one T, read its tool_result, then F."]
];

function recoveryInstruction(message: string): string {
  return recoveries.find(([pattern]) => pattern.test(message))?.[1] ?? "Retry only the rejected operation from evidence; never claim unsupported success.";
}

function traceStep(run: Run, turn: ModelTurn, parsedOps: GraphOp[], error?: string): TraceStep {
  const compact = run.args.traceMode === "compact";
  const completedAt = new Date();
  const frameView = (frame: GraphFrame) => (compact ? { frame: forkFrameMetadataOnly(frame).frame, graph: { nodes: [], edges: [] } } : frame);
  return {
    step: turn.step,
    startedAt: turn.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - turn.startedAt.getTime(),
    frameBefore: frameView(turn.frameBefore),
    prompt: compact ? "" : turn.prompt,
    tokenEstimate: estimateStateWeaveTokens(turn.prompt),
    streamedTokens: compact ? [] : turn.streamedTokens,
    ...(turn.modelMetadata.length ? { modelMetadata: turn.modelMetadata } : {}),
    rawModelOutput: turn.streamedTokens.join(""),
    parsedOps,
    frameAfter: frameView(run.frame),
    ...(error ? { error } : {})
  };
}

function runError(run: Run, message: string): StateWeaveRunError {
  return new StateWeaveRunError(message, run.trace, runMetadata(run, "error"), run.frame);
}

function runMetadata(run: Run, status: StateWeaveRunMetadata["status"]): StateWeaveRunMetadata {
  const { runId, tools, startedAt, maxIterations, maxPromptTokens, retryCount } = run.meta;
  const completedAt = status === "running" ? undefined : new Date();
  return {
    runId,
    tools,
    startedAt: startedAt.toISOString(),
    ...(completedAt ? { completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - startedAt.getTime() } : {}),
    maxIterations,
    maxPromptTokens,
    stepCount: run.trace.length,
    retryCount,
    status
  };
}
