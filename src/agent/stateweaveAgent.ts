import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentResult, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import type { Model } from "../llm/model.js";
import { createDefaultTools } from "../tools/fileSystemTools.js";
import type { Tool } from "../tools/types.js";
import { runStateWeave, StateWeaveRunError, streamStateWeave, type StateWeaveInput, type StateWeaveRunOptions } from "./stateweaveRunner.js";

export type { StateWeaveInput, StateWeaveRunOptions } from "./stateweaveRunner.js";

export class StateWeaveAgent {
  private model: Model;
  private tools: Tool[];
  private maxSteps: number;
  private traceDir?: string;

  constructor(args: { model: Model; tools?: Tool[]; maxSteps?: number; traceDir?: string }) {
    this.model = args.model;
    this.tools = args.tools ?? createDefaultTools();
    this.maxSteps = args.maxSteps ?? 5;
    this.traceDir = args.traceDir;
  }

  async run(input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
    try {
      const result = await runStateWeave({ model: this.model, tools: this.tools, maxSteps: this.maxSteps }, input, options);
      if (this.traceDir) await this.saveTrace(traceObjective(result.trace), result.trace);
      return result;
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  async *stream(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
    try {
      for await (const event of streamStateWeave({ model: this.model, tools: this.tools, maxSteps: this.maxSteps }, input, options)) {
        if (event.type === "final" && this.traceDir) await this.saveTrace(traceObjective(event.result.trace), event.result.trace);
        yield event;
      }
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private async saveTrace(objective: string, trace: TraceStep[]): Promise<void> {
    if (!this.traceDir) return;
    await mkdir(this.traceDir, { recursive: true });
    const safeName = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
    await writeFile(path.join(this.traceDir, `${Date.now()}-${safeName}.json`), JSON.stringify(trace, null, 2));
  }
}

function traceObjective(trace: TraceStep[]): string {
  return trace[0]?.frameBefore.frame.objective ?? "stateweave";
}
