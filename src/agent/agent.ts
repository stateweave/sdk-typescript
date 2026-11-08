// The public Agent: argument validation, run locking, streaming, and run metadata around the causal runtime.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentStateToGraph } from "../core/causalGraph.js";
import { projectCausalVisualSnapshot } from "../core/causalVisualGraph.js";
import { CausalWeave } from "../core/causalWeave.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import type { StateGraph } from "../core/types.js";
import { createDefaultTools } from "../tools/fileSystemTools.js";
import type { Tool } from "../tools/types.js";
import { AgentRuntime, normalizeNodeTypes, type RuntimeRunOptions } from "./agentRuntime.js";
import { defaultSemanticNodeTypes, type AgentArgs, type AgentRunOptions, type AgentRunResult, type AgentState, type AgentStreamEvent } from "./types.js";

export type * from "./types.js";
export { AgentRunError } from "./agentRuntime.js";

export const defaultAgentSystemPrompt = "You are a StateWeave agent. Complete the user's task accurately, use tools when needed, and preserve durable working state in the causal graph.";

export class Agent {
  private readonly args: Required<Pick<AgentArgs, "maxIterations" | "maxPromptTokens" | "projectionTargetTokens" | "projectionMaxNodes" | "contextMode" | "nodeTypes" | "allowDynamicNodeTypes">> & Omit<AgentArgs, "maxIterations" | "maxPromptTokens" | "projectionTargetTokens" | "projectionMaxNodes" | "contextMode" | "nodeTypes" | "allowDynamicNodeTypes" | "state">;
  private readonly tools: Tool[];
  private state?: AgentState;
  private runLock: Promise<void> = Promise.resolve();
  private stateGeneration = 0;

  constructor(args: AgentArgs) {
    const maxPromptTokens = boundedInteger(args.maxPromptTokens ?? 64_000, "maxPromptTokens", 256);
    const requestedProjectionTokens = boundedInteger(args.projectionTargetTokens ?? 16_000, "projectionTargetTokens", 256);
    const projectionTargetTokens = Math.min(requestedProjectionTokens, maxPromptTokens);
    const maxIterations = boundedInteger(args.maxIterations ?? 30, "maxIterations", 1);
    const projectionMaxNodes = boundedInteger(args.projectionMaxNodes ?? 48, "projectionMaxNodes", 4);
    const maxNoProgressIterations = args.maxNoProgressIterations === undefined
      ? undefined
      : boundedInteger(args.maxNoProgressIterations, "maxNoProgressIterations", 1);
    this.tools = args.tools ?? createDefaultTools();
    this.args = {
      ...args,
      tools: this.tools,
      systemPrompt: args.systemPrompt ?? defaultAgentSystemPrompt,
      maxIterations,
      maxNoProgressIterations,
      maxPromptTokens,
      projectionTargetTokens,
      projectionMaxNodes,
      contextMode: args.contextMode ?? "causal",
      nodeTypes: normalizeNodeTypes(args.nodeTypes ?? defaultSemanticNodeTypes),
      allowDynamicNodeTypes: args.allowDynamicNodeTypes ?? false
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
        projectionTargetTokens: this.args.projectionTargetTokens,
        projectionMaxNodes: this.args.projectionMaxNodes,
        contextMode: this.args.contextMode,
        nodeTypes: this.args.nodeTypes,
        allowDynamicNodeTypes: this.args.allowDynamicNodeTypes
      }
    });
    const running = this.runManaged(input, {
      ...options,
      signal,
      streamModel: true,
      onProgress: (progress) => {
        options.onProgress?.(progress);
        push({ type: "progress", progress });
      },
      onModelEvent: (event) => {
        if (event.type === "token") push({ type: "model_token", iteration: event.iteration, token: event.token });
        else push({ type: "model_metadata", iteration: event.iteration, metadata: event.metadata });
      }
    }, runId, startedAt)
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
    return this.state ? projectCausalVisualSnapshot(this.state, { maxVisibleNodes: this.args.projectionMaxNodes }).graph : agentStateToGraph();
  }

  reset(state?: AgentState): void {
    if (state) new CausalWeave(state);
    this.stateGeneration += 1;
    this.state = state ? cloneState(state) : undefined;
  }

  private async runManaged(input: TaskInput, options: RuntimeRunOptions, runId: string, startedAt: string): Promise<AgentRunResult> {
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

  private async runWithMetadata(input: TaskInput, state: AgentState | undefined, options: RuntimeRunOptions, runId: string, startedAt: string): Promise<AgentRunResult> {
    const started = Date.parse(startedAt);
    const task = normalizeTaskInput(input);
    const runtime = new AgentRuntime({
      model: this.args.model,
      tools: this.tools,
      systemPrompt: this.args.systemPrompt ?? defaultAgentSystemPrompt,
      maxIterations: this.args.maxIterations,
      maxContextTokens: this.args.maxPromptTokens,
      projectionTargetTokens: this.args.projectionTargetTokens,
      projectionMaxNodes: this.args.projectionMaxNodes,
      contextMode: this.args.contextMode,
      focusReranker: this.args.focusReranker,
      maxNoProgressIterations: this.args.maxNoProgressIterations,
      providerSystem: this.args.providerSystem,
      enforceCompletionEvidence: this.args.enforceCompletionEvidence ?? true,
      nodeTypes: this.args.nodeTypes,
      allowDynamicNodeTypes: this.args.allowDynamicNodeTypes,
      state
    });
    const runtimeResult = await runtime.run(task.input, options);
    const completedAt = new Date().toISOString();
    const result: AgentRunResult = {
      finalAnswer: runtimeResult.finalAnswer,
      state: runtimeResult.state,
      graph: runtimeResult.graph,
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
        projectionMaxNodes: this.args.projectionMaxNodes,
        contextMode: this.args.contextMode,
        nodeTypes: this.args.nodeTypes,
        allowDynamicNodeTypes: this.args.allowDynamicNodeTypes,
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

function cloneState(state: AgentState): AgentState {
  return structuredClone(state);
}

async function saveTrace(traceDir: string, objective: string, result: AgentRunResult): Promise<void> {
  await mkdir(traceDir, { recursive: true });
  const safeName = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64) || "stateweave";
  await writeFile(path.join(traceDir, `${Date.now()}-${safeName}.json`), JSON.stringify(result, null, 2));
}

function boundedInteger(value: number, name: string, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}; received ${String(value)}.`);
  return value;
}
