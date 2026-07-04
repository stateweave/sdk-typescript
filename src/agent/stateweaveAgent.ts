import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyOps, addToolResult } from "../core/applyOps.js";
import { appendInputToGraphFrame, cloneFrame, createInitialGraphFrame } from "../core/graph.js";
import { normalizeTaskInput, type TaskInput } from "../core/input.js";
import { serializeGraphFrame } from "../core/serialize.js";
import type { AgentResult, GraphFrame, GraphOp, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";
import { toolMap } from "../tools/mockTools.js";

export type StateWeaveInput = TaskInput;
export type StateWeaveRunOptions = { frame?: GraphFrame };

export class StateWeaveAgent {
  private model: Model;
  private tools: Map<string, Tool>;
  private maxSteps: number;
  private traceDir?: string;

  constructor(args: { model: Model; tools: Tool[]; maxSteps?: number; traceDir?: string }) {
    this.model = args.model;
    this.tools = toolMap(args.tools);
    this.maxSteps = args.maxSteps ?? 5;
    this.traceDir = args.traceDir;
  }

  async run(input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
    let result: AgentResult | undefined;
    for await (const event of this.stream(input, options)) {
      if (event.type === "final") result = event.result;
    }
    if (!result) throw new Error("StateWeave stream ended without a final result.");
    return result;
  }

  async *stream(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
    const task = normalizeTaskInput(input);
    let frame = options?.frame
      ? appendInputToGraphFrame(options.frame, task)
      : createInitialGraphFrame({
          objective: task.objective,
          input: task.input,
          availableActions: [...this.tools.values()].map((tool) => `tool:${tool.name} - ${tool.description}`)
        });
    const trace: TraceStep[] = [];
    let finalAnswer = "";

    for (let step = 1; step <= this.maxSteps; step++) {
      const frameBefore = cloneFrame(frame);
      const prompt = serializeGraphFrame(frameBefore);
      const streamedTokens: string[] = [];

      yield { type: "frame", step, phase: "before", frame: frameBefore };
      for await (const event of this.model.stream({ prompt, frame: frameBefore, mode: "graph_ops" })) {
        streamedTokens.push(event.token);
        yield { type: "token", step, token: event.token };
      }

      const rawModelOutput = streamedTokens.join("");
      const parsedOps = parseAndValidateOps(rawModelOutput);
      frame = await this.applyAndRunTools(frame, parsedOps, step);

      const final = parsedOps.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
      if (final) finalAnswer = final.answer;

      const frameAfter = cloneFrame(frame);
      trace.push({ step, frameBefore, prompt, tokenEstimate: estimateStateWeaveTokens(prompt), streamedTokens, rawModelOutput, parsedOps, frameAfter });
      yield { type: "ops", step, ops: parsedOps };
      yield { type: "frame", step, phase: "after", frame: frameAfter };
      if (finalAnswer) break;
    }

    if (!finalAnswer) finalAnswer = "No final answer produced before maxSteps.";
    const result = { finalAnswer, graph: frame.graph, trace };
    if (this.traceDir) await this.saveTrace(task.objective, trace);
    yield { type: "final", result };
  }

  private async applyAndRunTools(frame: GraphFrame, ops: GraphOp[], step: number): Promise<GraphFrame> {
    let next = applyOps(frame, ops);
    for (const op of ops) {
      if (op.op !== "call_tool") continue;
      const tool = this.tools.get(op.tool);
      if (!tool) throw new Error(`Unknown tool: ${op.tool}`);
      const args = tool.schema.parse(op.args);
      const result = await tool.execute(args);
      next = { ...next, graph: addToolResult(next.graph, { tool: op.tool, result, step }) };
      next.frame.currentFocus = `Use ${op.tool} result to decide the next graph mutation or final answer.`;
    }
    return next;
  }

  private async saveTrace(objective: string, trace: TraceStep[]): Promise<void> {
    if (!this.traceDir) return;
    await mkdir(this.traceDir, { recursive: true });
    const safeName = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
    await writeFile(path.join(this.traceDir, `${Date.now()}-${safeName}.json`), JSON.stringify(trace, null, 2));
  }
}
