import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentResult, GraphFrame, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import type { Model } from "../llm/model.js";
import { createDefaultTools } from "../tools/fileSystemTools.js";
import type { Tool } from "../tools/types.js";
import { runStateWeave, StateWeaveRunError, streamStateWeave, type StateWeaveInput, type StateWeaveRunOptions } from "./stateweaveRunner.js";

export type { StateWeaveInput, StateWeaveRunOptions } from "./stateweaveRunner.js";

export type StateWeaveAgentArgs = {
  model: Model;
  tools?: Tool[];
  maxSteps?: number;
  maxIterations?: number;
  nodeTypes?: string[];
  traceDir?: string;
  frame?: GraphFrame;
};

export class StateWeaveAgent {
  private model: Model;
  private tools: Tool[];
  private maxSteps: number;
  private nodeTypes: string[];
  private traceDir?: string;
  private frame?: GraphFrame;
  private stateQueue: Promise<void> = Promise.resolve();

  constructor(args: StateWeaveAgentArgs) {
    this.model = args.model;
    this.tools = args.tools ?? createDefaultTools();
    this.maxSteps = args.maxIterations ?? args.maxSteps ?? 5;
    this.nodeTypes = normalizeNodeTypes(args.nodeTypes ?? []);
    this.traceDir = args.traceDir;
    this.frame = args.frame;
  }

  async run(input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
    if (options?.frame) return this.runOnce(input, options, false);
    return this.withStateLock(() => this.runOnce(input, { frame: this.frame }, true));
  }

  async *stream(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
    if (options?.frame) {
      yield* this.streamOnce(input, options, false);
      return;
    }

    const release = await this.acquireStateLock();
    try {
      yield* this.streamOnce(input, { frame: this.frame }, true);
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
    return this.frame ? structuredClone(this.frame) : undefined;
  }

  resetFrame(frame?: GraphFrame): void {
    this.frame = frame ? structuredClone(frame) : undefined;
  }

  private async runOnce(input: StateWeaveInput, options: StateWeaveRunOptions | undefined, updateFrame: boolean): Promise<AgentResult> {
    try {
      const result = await runStateWeave({ model: this.model, tools: this.tools, maxSteps: this.maxSteps, nodeTypes: this.nodeTypes }, input, options);
      if (updateFrame) this.frame = result.frame;
      if (this.traceDir) await this.saveTrace(traceObjective(result.trace), result.trace);
      return result;
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private async *streamOnce(input: StateWeaveInput, options: StateWeaveRunOptions | undefined, updateFrame: boolean): AsyncIterable<StateWeaveStreamEvent> {
    try {
      for await (const event of streamStateWeave({ model: this.model, tools: this.tools, maxSteps: this.maxSteps, nodeTypes: this.nodeTypes }, input, options)) {
        if (event.type === "final") {
          if (updateFrame) this.frame = event.result.frame;
          if (this.traceDir) await this.saveTrace(traceObjective(event.result.trace), event.result.trace);
        }
        yield event;
      }
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private async withStateLock<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquireStateLock();
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async acquireStateLock(): Promise<() => void> {
    const previous = this.stateQueue.catch(() => undefined);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.stateQueue = previous.then(() => current);
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
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^[a-z][a-z0-9_-]{0,63}$/.test(value)))];
}
