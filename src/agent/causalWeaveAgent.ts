import { CausalWeave, type CausalCompileResult, type CausalWeaveSnapshot } from "../core/causalWeave.js";
import {
  baselineSystemPrompt,
  completionEvidenceGaps,
  createCompletionEvidence,
  executeAgentTool,
  parseToolCall,
  providerSystem,
  recordCompletionEvidence
} from "../evals/agenticBaseline.js";
import type { Model } from "../llm/model.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import type { Tool } from "../tools/types.js";

export type CausalWeaveProgress = {
  iteration: number;
  phase: "context" | "model" | "tool" | "final" | "retrying";
  modelCalls: number;
  toolCalls: number;
  totalInputTokens: number;
  outputTokens: number;
  detail: string;
};

export type CausalWeaveTraceStep = {
  step: number;
  nodeIds: string[];
  contextTokens: number;
  rawModelOutput: string;
  action: "tool" | "final" | "invalid";
  tool?: string;
  error?: string;
};

export type CausalWeaveResult = {
  finalAnswer: string;
  weave: CausalWeaveSnapshot;
  trace: CausalWeaveTraceStep[];
  metrics: {
    modelCalls: number;
    toolCalls: number;
    latestContextTokens: number;
    totalInputTokens: number;
    outputTokens: number;
  };
};

export class CausalWeaveRunError extends Error {
  constructor(message: string, readonly weave: CausalWeaveSnapshot, readonly trace: CausalWeaveTraceStep[], readonly metrics: CausalWeaveResult["metrics"]) {
    super(message);
    this.name = "CausalWeaveRunError";
  }
}

export class CausalWeaveAgent {
  private readonly model: Model;
  private readonly tools: Map<string, Tool>;
  private readonly maxIterations: number;
  private readonly maxContextTokens: number;
  private readonly maxNoProgressIterations?: number;
  private readonly providerSystem?: string;
  private readonly enforceCompletionEvidence: boolean;
  private readonly systemPrompt: string;
  private weave: CausalWeave;

  constructor(args: {
    model: Model;
    tools: Tool[];
    systemPrompt: string;
    maxIterations?: number;
    maxContextTokens?: number;
    maxNoProgressIterations?: number;
    providerSystem?: string;
    enforceCompletionEvidence?: boolean;
    weave?: CausalWeaveSnapshot;
  }) {
    this.model = args.model;
    this.tools = new Map(args.tools.map((tool) => [tool.name, tool]));
    this.maxIterations = args.maxIterations ?? 30;
    this.maxContextTokens = args.maxContextTokens ?? 64_000;
    this.maxNoProgressIterations = args.maxNoProgressIterations;
    this.providerSystem = args.providerSystem;
    this.enforceCompletionEvidence = args.enforceCompletionEvidence ?? false;
    this.systemPrompt = baselineSystemPrompt(args.systemPrompt, args.tools);
    this.weave = new CausalWeave(args.weave);
    if (!args.weave) this.weave.append({ kind: "system", payload: this.systemPrompt, parents: [], advance: false });
  }

  snapshot(): CausalWeaveSnapshot {
    return this.weave.snapshot();
  }

  async run(task: string, options: { signal?: AbortSignal; onProgress?: (progress: CausalWeaveProgress) => void } = {}): Promise<CausalWeaveResult> {
    options.signal?.throwIfAborted();
    const system = this.weave.snapshot().nodes.find((node) => node.kind === "system");
    const goal = this.weave.append({ kind: "goal", payload: task, parents: system ? [system.id] : [], advance: true });
    const evidence = createCompletionEvidence();
    const trace: CausalWeaveTraceStep[] = [];
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
    const progress = (iteration: number, phase: CausalWeaveProgress["phase"], detail: string): void => {
      options.onProgress?.({ iteration, phase, modelCalls, toolCalls, totalInputTokens, outputTokens, detail });
    };
    const metrics = (): CausalWeaveResult["metrics"] => ({ modelCalls, toolCalls, latestContextTokens, totalInputTokens, outputTokens });
    const fail = (message: string): never => { throw new CausalWeaveRunError(message, this.weave.snapshot(), trace, metrics()); };
    const enforceNoProgress = (iteration: number): void => {
      if (this.maxNoProgressIterations && iteration - lastMutationIteration >= this.maxNoProgressIterations) {
        fail(`No successful workspace mutation occurred in ${this.maxNoProgressIterations} consecutive model iterations; stopping the non-convergent causal run with its weave preserved.`);
      }
    };

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      options.signal?.throwIfAborted();
      progress(iteration, "context", "Compiling the active causal frontier");
      const compiled = this.weave.compile({ query: task, maxTokens: this.maxContextTokens });
      progress(iteration, "model", `Waiting for causal model iteration ${iteration}`);
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
          progress(iteration, "retrying", `Invalid causal action ${repeatedInvalidCount}/3`);
          if (repeatedInvalidCount >= 3) fail(`Causal agent repeated the same invalid action envelope 3 times: ${invalid.replace(/\s+/g, " ").slice(0, 240)}`);
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
          progress(iteration, "retrying", `Final blocked by missing evidence: ${missing}`);
          if (repeatedMissingEvidenceCount >= 3) fail(`Causal agent repeated an unsupported final 3 times; missing evidence: ${missing}`);
          enforceNoProgress(iteration);
          continue;
        }
        this.weave.append({ kind: "answer", payload: answer, parents: compiled.nodeIds, advance: true });
        trace.push(traceStep(iteration, compiled, output.text, "final"));
        progress(iteration, "final", "Causal agent produced a final answer");
        return { finalAnswer: answer, weave: this.weave.snapshot(), trace, metrics: metrics() };
      }

      repeatedInvalidOutput = "";
      repeatedInvalidCount = 0;
      const canonical = { name: call.name, args: call.args };
      const callNode = this.weave.append({ kind: "tool_call", payload: { ...canonical, raw: output.text }, parents: compiled.nodeIds, advance: true });
      progress(iteration, "tool", `Running causal tool ${call.name}`);
      options.signal?.throwIfAborted();
      const result = await executeAgentTool(this.tools, call);
      options.signal?.throwIfAborted();
      toolCalls += 1;
      recordCompletionEvidence(evidence, call.name, call.args, result);
      const resultNode = this.weave.append({ kind: "tool_result", payload: { tool: call.name, result }, parents: [callNode.id], advance: true });
      const resources = resourceChanges(call.name, call.args, result);
      for (const resource of resources) {
        this.weave.append({ kind: "resource", payload: resource.payload, parents: [resultNode.id], resourceKey: resource.key, advance: true });
      }
      if (meaningfulMutationPaths(call.name, call.args, result).length) lastMutationIteration = iteration;
      trace.push(traceStep(iteration, compiled, output.text, "tool", call.name));

      enforceNoProgress(iteration);
      if (iteration === this.maxIterations) break;
    }

    return fail(`Causal agent recursion limit reached after ${this.maxIterations} iterations.`);
  }
}

function traceStep(step: number, compiled: CausalCompileResult, rawModelOutput: string, action: CausalWeaveTraceStep["action"], tool?: string, error?: string): CausalWeaveTraceStep {
  return {
    step,
    nodeIds: compiled.nodeIds,
    contextTokens: compiled.tokenEstimate.estimatedTokens,
    rawModelOutput,
    action,
    ...(tool ? { tool } : {}),
    ...(error ? { error } : {})
  };
}

function resourceChanges(toolName: string, args: unknown, result: unknown): { key: string; payload: Record<string, unknown> }[] {
  const toolArgs = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const paths = new Set<string>();
  const direct = record.file_path ?? record.path ?? toolArgs.file_path ?? toolArgs.path;
  if (typeof direct === "string" && direct) paths.add(direct);
  if (Array.isArray(record.mutated_paths)) for (const path of record.mutated_paths) if (typeof path === "string" && path) paths.add(path);
  return [...paths].map((path) => ({
    key: path,
    payload: {
      path,
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
