import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentStateToGraph } from "../core/causalGraph.js";
import { CausalWeave, type CausalCompileResult } from "../core/causalWeave.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import type { StateGraph } from "../core/types.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import { createDefaultTools } from "../tools/fileSystemTools.js";
import type { Tool } from "../tools/types.js";
import type { AgentArgs, AgentProgress, AgentRunOptions, AgentRunResult, AgentState, AgentStreamEvent, AgentTraceStep } from "./types.js";
import {
  agentSystemPrompt,
  completionEvidenceGaps,
  createCompletionEvidence,
  executeAgentTool,
  parseToolCall,
  providerSystem,
  recordCompletionEvidence
} from "./toolProtocol.js";

export type * from "./types.js";

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly state: AgentState,
    readonly graph: StateGraph,
    readonly trace: AgentTraceStep[],
    readonly metrics: RuntimeResult["metrics"]
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

const defaultSystemPrompt = "You are a StateWeave agent. Complete the user's task accurately, use tools when needed, and preserve durable working state in the causal graph.";

export class Agent {
  private readonly args: Required<Pick<AgentArgs, "maxIterations" | "maxPromptTokens" | "projectionTargetTokens">> & Omit<AgentArgs, "maxIterations" | "maxPromptTokens" | "projectionTargetTokens" | "state">;
  private readonly tools: Tool[];
  private state?: AgentState;
  private runLock: Promise<void> = Promise.resolve();
  private stateGeneration = 0;

  constructor(args: AgentArgs) {
    const maxPromptTokens = args.maxPromptTokens ?? 64_000;
    const projectionTargetTokens = Math.min(args.projectionTargetTokens ?? 16_000, maxPromptTokens);
    this.tools = args.tools ?? createDefaultTools();
    this.args = {
      ...args,
      tools: this.tools,
      systemPrompt: args.systemPrompt ?? defaultSystemPrompt,
      maxIterations: args.maxIterations ?? 30,
      maxPromptTokens,
      projectionTargetTokens
    };
    this.state = args.state ? cloneState(args.state) : undefined;
    if (this.state) new CausalWeave(this.state);
  }

  async run(input: TaskInput, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const startedAt = new Date().toISOString();
    return this.runManaged(input, options, `sw_${randomUUID()}`, startedAt);
  }

  async *stream(input: TaskInput, options: AgentRunOptions = {}): AsyncIterable<string> {
    for await (const event of this.streamEvents(input, options)) if (event.type === "final") yield event.result.finalAnswer;
  }

  streamText(input: TaskInput, options: AgentRunOptions = {}): AsyncIterable<string> {
    return this.stream(input, options);
  }

  async *streamEvents(input: TaskInput, options: AgentRunOptions = {}): AsyncIterable<AgentStreamEvent> {
    const queue: AgentStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let done = false;
    let failure: unknown;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const push = (event: AgentStreamEvent): void => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };
    const startedAt = new Date().toISOString();
    const runId = `sw_${randomUUID()}`;
    push({
      type: "metadata",
      metadata: {
        runId,
        engine: "causal-weave-v3",
        tools: this.tools.map(({ name, description }) => ({ name, description })),
        startedAt,
        maxIterations: this.args.maxIterations,
        maxPromptTokens: this.args.maxPromptTokens,
        projectionTargetTokens: this.args.projectionTargetTokens
      }
    });
    const running = this.runManaged(input, { ...options, signal, onProgress: (progress) => {
      options.onProgress?.(progress);
      push({ type: "progress", progress });
    } }, runId, startedAt)
      .then((result) => { push({ type: "final", result }); })
      .catch((error) => { failure = error; })
      .finally(() => { done = true; wake?.(); wake = undefined; });

    try {
      while (!done || queue.length) {
        if (queue.length) yield queue.shift()!;
        else await new Promise<void>((resolve) => { wake = resolve; });
      }
      if (failure) throw failure;
      await running;
    } finally {
      if (!done) controller.abort(new DOMException("Stream consumer closed", "AbortError"));
      await running.catch(() => undefined);
    }
  }

  getState(): AgentState | undefined {
    return this.state ? cloneState(this.state) : undefined;
  }

  getGraph(): StateGraph {
    return agentStateToGraph(this.state);
  }

  reset(state?: AgentState): void {
    if (state) new CausalWeave(state);
    this.stateGeneration += 1;
    this.state = state ? cloneState(state) : undefined;
  }

  private async runManaged(input: TaskInput, options: AgentRunOptions, runId: string, startedAt: string): Promise<AgentRunResult> {
    if (options.state) return this.runWithMetadata(input, options.state, options, runId, startedAt);
    const release = await this.acquireRunLock();
    const generation = this.stateGeneration;
    try {
      const result = await this.runWithMetadata(input, this.state, options, runId, startedAt);
      if (generation === this.stateGeneration) this.state = cloneState(result.state);
      return result;
    } finally {
      release();
    }
  }

  private async runWithMetadata(input: TaskInput, state: AgentState | undefined, options: AgentRunOptions, runId: string, startedAt: string): Promise<AgentRunResult> {
    const started = Date.parse(startedAt);
    const task = normalizeTaskInput(input);
    const runtime = new AgentRuntime({
      model: this.args.model,
      tools: this.tools,
      systemPrompt: this.args.systemPrompt ?? defaultSystemPrompt,
      maxIterations: this.args.maxIterations,
      maxContextTokens: this.args.maxPromptTokens,
      projectionTargetTokens: this.args.projectionTargetTokens,
      maxNoProgressIterations: this.args.maxNoProgressIterations,
      providerSystem: this.args.providerSystem,
      enforceCompletionEvidence: this.args.enforceCompletionEvidence ?? true,
      state
    });
    const runtimeResult = await runtime.run(task.input, options);
    const completedAt = new Date().toISOString();
    const result: AgentRunResult = {
      finalAnswer: runtimeResult.finalAnswer,
      state: runtimeResult.state,
      graph: agentStateToGraph(runtimeResult.state),
      trace: runtimeResult.trace,
      metadata: {
        runId,
        engine: "causal-weave-v3",
        tools: this.tools.map(({ name, description }) => ({ name, description })),
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - started,
        maxIterations: this.args.maxIterations,
        maxPromptTokens: this.args.maxPromptTokens,
        projectionTargetTokens: this.args.projectionTargetTokens,
        stepCount: runtimeResult.trace.length,
        ...runtimeResult.metrics,
        status: "done"
      }
    };
    if (this.args.traceDir) await saveTrace(this.args.traceDir, task.objective, result);
    return result;
  }

  private async acquireRunLock(): Promise<() => void> {
    const previous = this.runLock.catch(() => undefined);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.runLock = previous.then(() => current);
    await previous;
    return release;
  }
}

type RuntimeResult = {
  finalAnswer: string;
  state: AgentState;
  trace: AgentTraceStep[];
  metrics: {
    modelCalls: number;
    toolCalls: number;
    latestContextTokens: number;
    totalInputTokens: number;
    outputTokens: number;
  };
};

class AgentRuntime {
  private readonly model: Model;
  private readonly tools: Map<string, Tool>;
  private readonly maxIterations: number;
  private readonly maxContextTokens: number;
  private readonly projectionTargetTokens: number;
  private readonly maxNoProgressIterations?: number;
  private readonly providerSystem?: string;
  private readonly enforceCompletionEvidence: boolean;
  private readonly weave: CausalWeave;

  constructor(args: {
    model: Model;
    tools: Tool[];
    systemPrompt: string;
    maxIterations: number;
    maxContextTokens: number;
    projectionTargetTokens: number;
    maxNoProgressIterations?: number;
    providerSystem?: string;
    enforceCompletionEvidence: boolean;
    state?: AgentState;
  }) {
    this.model = args.model;
    this.tools = new Map(args.tools.map((tool) => [tool.name, tool]));
    this.maxIterations = args.maxIterations;
    this.maxContextTokens = args.maxContextTokens;
    this.projectionTargetTokens = args.projectionTargetTokens;
    this.maxNoProgressIterations = args.maxNoProgressIterations;
    this.providerSystem = args.providerSystem;
    this.enforceCompletionEvidence = args.enforceCompletionEvidence;
    this.weave = new CausalWeave(args.state);
    const systemPayload = agentSystemPrompt(args.systemPrompt, args.tools);
    const current = this.weave.snapshot();
    const latestSystem = current.nodes.filter((node) => node.kind === "system").at(-1);
    if (!latestSystem) this.weave.append({ kind: "system", payload: systemPayload, parents: current.frontier, advance: false });
    else if (latestSystem.payload !== systemPayload) this.weave.append({ kind: "system", payload: systemPayload, parents: current.frontier, advance: true });
  }

  async run(task: string, options: AgentRunOptions): Promise<RuntimeResult> {
    options.signal?.throwIfAborted();
    const beforeGoal = this.weave.snapshot();
    const system = beforeGoal.nodes.filter((node) => node.kind === "system").at(-1);
    const parents = [...new Set([...(system ? [system.id] : []), ...beforeGoal.frontier])];
    this.weave.append({ kind: "goal", payload: task, parents, advance: true });
    const evidence = createCompletionEvidence();
    const trace: AgentTraceStep[] = [];
    let modelCalls = 0;
    let toolCalls = 0;
    let latestContextTokens = 0;
    let totalInputTokens = 0;
    let outputTokens = 0;
    let repeatedInvalidOutput = "";
    let repeatedInvalidCount = 0;
    let repeatedMissingEvidence = "";
    let repeatedMissingEvidenceCount = 0;
    let lastMutationIteration = 0;
    const metrics = (): RuntimeResult["metrics"] => ({ modelCalls, toolCalls, latestContextTokens, totalInputTokens, outputTokens });
    const progress = (iteration: number, phase: AgentProgress["phase"], detail: string, extra: Partial<AgentProgress> = {}): void => {
      const includeGraph = phase === "context" || phase === "final" || phase === "retrying";
      options.onProgress?.({
        iteration,
        phase,
        modelCalls,
        toolCalls,
        totalInputTokens,
        outputTokens,
        detail,
        ...(includeGraph ? { graph: agentStateToGraph(this.weave.snapshot()) } : {}),
        ...extra
      });
    };
    const fail = (message: string): never => {
      const state = this.weave.snapshot();
      throw new AgentRunError(message, state, agentStateToGraph(state), trace, metrics());
    };
    const enforceNoProgress = (iteration: number): void => {
      if (this.maxNoProgressIterations && iteration - lastMutationIteration >= this.maxNoProgressIterations) {
        fail(`No successful workspace mutation occurred in ${this.maxNoProgressIterations} consecutive model iterations; the preserved state is attached to this error.`);
      }
    };

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      options.signal?.throwIfAborted();
      const compiled = this.weave.compile({ query: task, maxTokens: this.maxContextTokens, targetTokens: this.projectionTargetTokens });
      progress(iteration, "context", "Compiled the active causal frontier", { prompt: compiled.prompt, contextTokens: compiled.tokenEstimate.estimatedTokens });
      progress(iteration, "model", `Waiting for model iteration ${iteration}`, { contextTokens: compiled.tokenEstimate.estimatedTokens });
      const output = await this.model.complete({
        prompt: compiled.prompt,
        mode: "text",
        system: providerSystem(this.providerSystem, "Follow the supplied tool protocol exactly. Return one TOOL_CALL JSON object or one FINAL response."),
        signal: options.signal
      });
      modelCalls += 1;
      latestContextTokens = output.usage?.inputTokens ?? compiled.tokenEstimate.estimatedTokens;
      totalInputTokens += latestContextTokens;
      outputTokens += output.usage?.outputTokens ?? estimateStateWeaveTokens(output.text).estimatedTokens;

      const call = parseToolCall(output.text);
      if (!call) {
        if (!/^\s*FINAL\s*:/i.test(output.text)) {
          const invalid = output.text.trim();
          repeatedInvalidCount = invalid === repeatedInvalidOutput ? repeatedInvalidCount + 1 : 1;
          repeatedInvalidOutput = invalid;
          const inference = this.weave.append({ kind: "inference", payload: invalid, parents: compiled.nodeIds, advance: true });
          const detail = /^\s*TOOL_CALL\b/i.test(output.text)
            ? "The TOOL_CALL JSON was malformed or truncated. Retry with exactly one smaller valid TOOL_CALL object."
            : "Planning prose is not an action. Return exactly one TOOL_CALL JSON object, or FINAL: followed by the factual answer.";
          this.weave.append({ kind: "protocol_error", payload: detail, parents: [inference.id], advance: true });
          trace.push(traceStep(iteration, compiled, output.text, "invalid", undefined, detail));
          progress(iteration, "retrying", `Invalid action ${repeatedInvalidCount}/3`, { rawModelOutput: output.text, action: "invalid", error: detail });
          if (repeatedInvalidCount >= 3) fail(`Agent repeated the same invalid action envelope 3 times: ${invalid.replace(/\s+/g, " ").slice(0, 240)}`);
          enforceNoProgress(iteration);
          continue;
        }

        const answer = output.text.replace(/^\s*FINAL\s*:\s*/i, "").trim();
        const missingEvidence = this.enforceCompletionEvidence ? completionEvidenceGaps(task, evidence, answer) : [];
        if (missingEvidence.length) {
          const missing = missingEvidence.join(", ");
          repeatedMissingEvidenceCount = missing === repeatedMissingEvidence ? repeatedMissingEvidenceCount + 1 : 1;
          repeatedMissingEvidence = missing;
          const unsupported = this.weave.append({ kind: "inference", payload: { unsupportedFinal: answer }, parents: compiled.nodeIds, advance: true });
          this.weave.append({ kind: "protocol_error", payload: `Final is unsupported. Still required: ${missing}. Continue with one TOOL_CALL.`, parents: [unsupported.id], advance: true });
          trace.push(traceStep(iteration, compiled, output.text, "invalid", undefined, missing));
          progress(iteration, "retrying", `Final blocked by missing evidence: ${missing}`, { rawModelOutput: output.text, action: "invalid", error: missing });
          if (repeatedMissingEvidenceCount >= 3) fail(`Agent repeated an unsupported final 3 times; missing evidence: ${missing}`);
          enforceNoProgress(iteration);
          continue;
        }
        this.weave.append({ kind: "answer", payload: answer, parents: compiled.nodeIds, advance: true });
        trace.push(traceStep(iteration, compiled, output.text, "final"));
        progress(iteration, "final", "Agent produced a final answer", { rawModelOutput: output.text, action: "final" });
        return { finalAnswer: answer, state: this.weave.snapshot(), trace, metrics: metrics() };
      }

      repeatedInvalidOutput = "";
      repeatedInvalidCount = 0;
      const callNode = this.weave.append({ kind: "tool_call", payload: { name: call.name, args: call.args, raw: output.text }, parents: compiled.nodeIds, advance: true });
      progress(iteration, "tool", `Running ${call.name}`, { rawModelOutput: output.text, action: "tool", tool: call.name });
      options.signal?.throwIfAborted();
      const result = await executeAgentTool(this.tools, call);
      options.signal?.throwIfAborted();
      toolCalls += 1;
      recordCompletionEvidence(evidence, call.name, call.args, result);
      const resultNode = this.weave.append({ kind: "tool_result", payload: { tool: call.name, result }, parents: [callNode.id], advance: true });
      for (const resource of resourceChanges(call.name, call.args, result)) {
        this.weave.append({ kind: "resource", payload: resource.payload, parents: [resultNode.id], resourceKey: resource.key, advance: true });
      }
      if (meaningfulMutationPaths(call.name, call.args, result).length) lastMutationIteration = iteration;
      trace.push(traceStep(iteration, compiled, output.text, "tool", call.name));
      progress(iteration, "context", `Recorded ${call.name} result`, { action: "tool", tool: call.name });
      enforceNoProgress(iteration);
    }

    return fail(`Agent recursion limit reached after ${this.maxIterations} iterations. Increase maxIterations to continue.`);
  }
}

function traceStep(step: number, compiled: CausalCompileResult, rawModelOutput: string, action: AgentTraceStep["action"], tool?: string, error?: string): AgentTraceStep {
  return {
    step,
    nodeIds: compiled.nodeIds,
    prompt: compiled.prompt,
    contextTokens: compiled.tokenEstimate.estimatedTokens,
    rawModelOutput,
    action,
    ...(tool ? { tool } : {}),
    ...(error ? { error } : {})
  };
}

function cloneState(state: AgentState): AgentState {
  return structuredClone(state);
}

async function saveTrace(traceDir: string, objective: string, result: AgentRunResult): Promise<void> {
  await mkdir(traceDir, { recursive: true });
  const safeName = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64) || "stateweave";
  await writeFile(path.join(traceDir, `${Date.now()}-${safeName}.json`), JSON.stringify(result, null, 2));
}

function resourceChanges(toolName: string, args: unknown, result: unknown): { key: string; payload: Record<string, unknown> }[] {
  const toolArgs = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const paths = new Set<string>();
  const direct = record.file_path ?? record.path ?? toolArgs.file_path ?? toolArgs.path;
  if (typeof direct === "string" && direct) paths.add(direct);
  if (Array.isArray(record.mutated_paths)) for (const value of record.mutated_paths) if (typeof value === "string" && value) paths.add(value);
  return [...paths].map((filePath) => ({
    key: filePath,
    payload: {
      path: filePath,
      operation: toolName,
      ...(typeof record.content_hash === "string" ? { contentHash: record.content_hash } : {}),
      ...(typeof record.bytes === "number" ? { bytes: record.bytes } : {}),
      succeeded: toolSucceeded(result)
    }
  }));
}

function meaningfulMutationPaths(toolName: string, args: unknown, result: unknown): string[] {
  if (!toolSucceeded(result)) return [];
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const toolArgs = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const values = toolName === "write_file" || toolName === "edit_file"
    ? [toolArgs.file_path ?? toolArgs.path]
    : Array.isArray(record.mutated_paths) ? record.mutated_paths : [];
  return values.filter((value): value is string => typeof value === "string" && isMeaningfulPath(value));
}

function isMeaningfulPath(filePath: string): boolean {
  const segments = filePath.replaceAll("\\", "/").split("/").filter(Boolean);
  const ignored = new Set(["node_modules", ".home", ".npm-cache", ".cache", ".vite", "dist", "build", "coverage", "logs", "tmp"]);
  if (segments.some((segment) => ignored.has(segment))) return false;
  const name = segments.at(-1) ?? filePath;
  return !/(?:\.log|\.pid|\.tmp|\.cache|\.tsbuildinfo)$/i.test(name)
    && !/^(?:test|vitest|build|npm)[-_].*\.(?:log|txt|json)$/i.test(name);
}

function toolSucceeded(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const record = result as Record<string, unknown>;
  if (record.error !== undefined || record.ok === false) return false;
  return typeof record.exitCode !== "number" || record.exitCode === 0;
}
