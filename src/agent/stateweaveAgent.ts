import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendInputToGraphFrame, assertValidGraphFrame, cloneFrame, createInitialGraphFrame, forkFrame } from "../core/graph.js";
import { normalizeTaskInput } from "../core/input.js";
import type { AgentResult, GraphFrame, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import type { Model } from "../llm/model.js";
import { createDefaultTools } from "../tools/fileSystemTools.js";
import type { Tool } from "../tools/types.js";
import { runStateWeave, StateWeaveRunError, streamStateWeave, type StateWeaveInput, type StateWeaveRunOptions } from "./stateweaveRunner.js";

export type { StateWeaveInput, StateWeaveRunOptions } from "./stateweaveRunner.js";

const defaultMaxIterations = 30;

export type StateWeaveAgentArgs = {
  model: Model;
  tools?: Tool[];
  maxIterations?: number;
  maxNoProgressIterations?: number;
  maxPromptTokens?: number;
  systemPrompt?: string;
  nodeTypes?: string[];
  traceDir?: string;
  frame?: GraphFrame;
  traceMode?: "full" | "compact";
  blindIdentity?: boolean;
  providerSystem?: string;
};

export class StateWeaveAgent {
  private model: Model;
  private tools: Tool[];
  private maxIterations: number;
  private maxNoProgressIterations?: number;
  private maxPromptTokens: number;
  private systemPrompt?: string;
  private nodeTypes: string[];
  private traceDir?: string;
  private frame?: GraphFrame;
  private traceMode: "full" | "compact";
  private blindIdentity: boolean;
  private providerSystem?: string;
  private runLock: Promise<void> = Promise.resolve();
  private stateGeneration = 0;

  constructor(args: StateWeaveAgentArgs) {
    this.model = args.model;
    this.tools = args.tools ?? createDefaultTools();
    this.maxIterations = args.maxIterations ?? defaultMaxIterations;
    this.maxNoProgressIterations = args.maxNoProgressIterations;
    this.maxPromptTokens = args.maxPromptTokens ?? 64_000;
    this.systemPrompt = args.systemPrompt;
    this.nodeTypes = normalizeNodeTypes(args.nodeTypes ?? []);
    this.traceDir = args.traceDir;
    if (args.frame) assertValidGraphFrame(args.frame);
    this.frame = args.frame ? cloneFrame(args.frame) : undefined;
    this.traceMode = args.traceMode ?? "full";
    this.blindIdentity = args.blindIdentity ?? false;
    this.providerSystem = args.providerSystem;
  }

  async run(input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
    if (options?.frame) return this.runOnce(input, options);

    const release = await this.acquireRunLock();
    const generation = this.stateGeneration;
    try {
      const baseFrame = this.frameForInput(input);
      const result = await this.runOnce(input, { ...options, frame: baseFrame, inputAlreadyAppended: true });
      if (generation === this.stateGeneration) this.frame = cloneFrame(result.frame);
      return result;
    } finally {
      release();
    }
  }

  async *stream(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
    if (options?.frame) {
      yield* this.streamOnce(input, options);
      return;
    }

    const release = await this.acquireRunLock();
    const generation = this.stateGeneration;
    try {
      const baseFrame = this.frameForInput(input);
      for await (const event of this.streamOnce(input, { ...options, frame: baseFrame, inputAlreadyAppended: true })) {
        if (event.type === "final" && generation === this.stateGeneration) this.frame = cloneFrame(event.result.frame);
        yield event;
      }
    } finally {
      release();
    }
  }

  async *streamText(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<string> {
    for await (const event of this.stream(input, options)) {
      if (event.type === "final") yield event.result.finalAnswer;
    }
  }

  getFrame(): GraphFrame | undefined {
    return this.frame ? cloneFrame(this.frame) : undefined;
  }

  resetFrame(frame?: GraphFrame): void {
    if (frame) assertValidGraphFrame(frame);
    this.stateGeneration += 1;
    this.frame = frame ? cloneFrame(frame) : undefined;
  }

  private frameForInput(input: StateWeaveInput): GraphFrame {
    const task = normalizeTaskInput(input);
    const next = this.frame
      ? appendInputToGraphFrame(this.frame, task)
      : createInitialGraphFrame({
          objective: task.objective,
          input: task.input,
          systemPrompt: this.systemPrompt,
          availableActions: this.toolActions(),
          nodeTypes: this.nodeTypes
        });
    next.frame.nodeTypes = normalizeNodeTypes([...this.nodeTypes, ...(next.frame.nodeTypes ?? [])]);
    return forkFrame(next);
  }

  private async runOnce(input: StateWeaveInput, options: StateWeaveRunOptions | undefined): Promise<AgentResult> {
    try {
      const result = await runStateWeave({ model: this.model, tools: this.tools, maxIterations: this.maxIterations, maxNoProgressIterations: this.maxNoProgressIterations, maxPromptTokens: this.maxPromptTokens, systemPrompt: this.systemPrompt, nodeTypes: this.nodeTypes, traceMode: this.traceMode, blindIdentity: this.blindIdentity, providerSystem: this.providerSystem }, input, options);
      if (this.traceDir) await this.saveTrace(traceObjective(result.trace), result.trace);
      return result;
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private async *streamOnce(input: StateWeaveInput, options: StateWeaveRunOptions | undefined): AsyncIterable<StateWeaveStreamEvent> {
    try {
      for await (const event of streamStateWeave({ model: this.model, tools: this.tools, maxIterations: this.maxIterations, maxNoProgressIterations: this.maxNoProgressIterations, maxPromptTokens: this.maxPromptTokens, systemPrompt: this.systemPrompt, nodeTypes: this.nodeTypes, traceMode: this.traceMode, blindIdentity: this.blindIdentity, providerSystem: this.providerSystem }, input, options)) {
        if (event.type === "final" && this.traceDir) await this.saveTrace(traceObjective(event.result.trace), event.result.trace);
        yield event;
      }
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private toolActions(): string[] {
    return this.tools.map((tool) => `tool:${tool.name} - ${tool.description}`);
  }

  private async acquireRunLock(): Promise<() => void> {
    const previous = this.runLock.catch(() => undefined);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.runLock = previous.then(() => current);
    await previous;
    return release;
  }

  private async saveTrace(objective: string, trace: TraceStep[]): Promise<void> {
    if (!this.traceDir) return;
    await mkdir(this.traceDir, { recursive: true });
    const safeName = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
    await writeFile(path.join(this.traceDir, `${Date.now()}-${safeName}.json`), JSON.stringify(trace, null, 2));
  }
}

export class Agent {
  private readonly inner: StateWeaveAgent;

  constructor(args: StateWeaveAgentArgs) {
    this.inner = new StateWeaveAgent(args);
  }

  run(input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
    return this.inner.run(input, options);
  }

  stream(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<string> {
    return this.inner.streamText(input, options);
  }

  streamText(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<string> {
    return this.inner.streamText(input, options);
  }

  streamEvents(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
    return this.inner.stream(input, options);
  }

  getFrame(): GraphFrame | undefined {
    return this.inner.getFrame();
  }

  resetFrame(frame?: GraphFrame): void {
    this.inner.resetFrame(frame);
  }
}

function traceObjective(trace: TraceStep[]): string {
  return trace[0]?.frameBefore.frame.objective ?? "stateweave";
}

function normalizeNodeTypes(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter((value) => /^[a-z][a-z0-9_-]{0,63}$/.test(value)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
