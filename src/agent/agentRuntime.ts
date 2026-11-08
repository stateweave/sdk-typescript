// The causal Agent loop: compile context → call model → record one TOOL_CALL or accept one evidence-backed FINAL.
import { projectCausalVisualSnapshot } from "../core/causalVisualGraph.js";
import { CausalWeave, type CausalCompileResult } from "../core/causalWeave.js";
import type { StateGraph } from "../core/types.js";
import type { Model, ModelInput, ModelOutput } from "../llm/model.js";
import type { Tool } from "../tools/types.js";
import { meaningfulMutationPaths, resourceChanges, verificationRecord } from "./agentEvidence.js";
import { prepareRunRecall, rankFocus, type RunFocus, type RunRecall } from "./agentFocus.js";
import { collectStreamedModelOutput, UsageMeter } from "./agentUsage.js";
import type { FocusDiagnostics, FocusReranker } from "./focusReranker.js";
import {
  agentSystemPrompt,
  completionAnswerGaps,
  completionEvidenceGaps,
  createCompletionEvidence,
  executeAgentTool,
  parseFinal,
  parseToolCall,
  providerSystem,
  recordCompletionEvidence,
  type ParsedFinal,
  type SemanticNodeInput
} from "./toolProtocol.js";
import type { AgentModelEvent, AgentProgress, AgentRunOptions, AgentState, AgentTraceStep, RecallDiagnostics, SemanticNodeType, TokenCountSource } from "./types.js";

const MAX_RETRIES = 3;

export type RuntimeRunOptions = AgentRunOptions & { streamModel?: boolean; onModelEvent?: (event: AgentModelEvent) => void };

export type RuntimeMetrics = {
  modelCalls: number;
  toolCalls: number;
  latestContextTokens: number;
  peakContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  tokenCountSource: TokenCountSource;
  focus?: FocusDiagnostics;
  recall?: RecallDiagnostics;
};

export type RuntimeResult = { finalAnswer: string; state: AgentState; graph: StateGraph; trace: AgentTraceStep[]; metrics: RuntimeMetrics };

export type RuntimeConfig = {
  model: Model;
  tools: Tool[];
  systemPrompt: string;
  maxIterations: number;
  maxContextTokens: number;
  projectionTargetTokens: number;
  projectionMaxNodes: number;
  contextMode: "causal" | "molecular";
  focusReranker?: FocusReranker;
  maxNoProgressIterations?: number;
  providerSystem?: string;
  enforceCompletionEvidence: boolean;
  nodeTypes: SemanticNodeType[];
  allowDynamicNodeTypes: boolean;
  state?: AgentState;
};

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly state: AgentState,
    readonly graph: StateGraph,
    readonly trace: AgentTraceStep[],
    readonly metrics: RuntimeMetrics
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

type Retry = { key: string; count: number };
type ToolCall = NonNullable<ReturnType<typeof parseToolCall>>;

/** Mutable state of one run. */
class RunState {
  readonly usage = new UsageMeter();
  readonly trace: AgentTraceStep[] = [];
  readonly evidence = createCompletionEvidence();
  readonly evidenceTask: string;
  invalid: Retry = { key: "", count: 0 };
  unsupported: Retry = { key: "", count: 0 };
  consecutiveRetries = 0;
  lastMutationIteration = 0;
  latestCompiled?: CausalCompileResult;

  constructor(readonly task: string, readonly options: RuntimeRunOptions, readonly recall: RunRecall, readonly focus: RunFocus) {
    this.evidenceTask = task.replace(/\b((?:which|what)\b[^?.!\n]{0,200})\bapply(?=\s*(?:(?:here|now)\s*)?\?)/gi, "$1are applicable");
  }

  metrics(): RuntimeMetrics {
    const { focus } = this.focus;
    return { ...this.usage.totals(), ...(focus ? { focus: structuredClone(focus) } : {}), recall: structuredClone(this.recall.recall) };
  }

  /** Counts a retry; returns how often this exact rejection repeated. */
  retry(kind: "invalid" | "unsupported", key: string): number {
    const previous = this[kind];
    this[kind] = { key, count: key === previous.key ? previous.count + 1 : 1 };
    this.consecutiveRetries += 1;
    return this[kind].count;
  }

  resetRetries(): void {
    this.invalid = { key: "", count: 0 };
    this.unsupported = { key: "", count: 0 };
    this.consecutiveRetries = 0;
  }
}

export class AgentRuntime {
  private readonly tools: Map<string, Tool>;
  private readonly weave: CausalWeave;

  constructor(private readonly config: RuntimeConfig) {
    this.tools = new Map(config.tools.map((tool) => [tool.name, tool]));
    this.weave = new CausalWeave(config.state);
    const systemPayload = agentSystemPrompt(config.systemPrompt, config.tools, config.nodeTypes, config.allowDynamicNodeTypes);
    const current = this.weave.snapshot();
    const latestSystem = current.nodes.filter((node) => node.kind === "system").at(-1);
    if (latestSystem?.payload !== systemPayload) this.weave.append({ kind: "system", payload: systemPayload, parents: current.frontier, advance: Boolean(latestSystem) });
  }

  async run(task: string, options: RuntimeRunOptions): Promise<RuntimeResult> {
    options.signal?.throwIfAborted();
    const beforeGoal = this.weave.snapshot();
    const system = beforeGoal.nodes.filter((node) => node.kind === "system").at(-1);
    this.weave.append({ kind: "goal", payload: task, parents: [...new Set([...(system ? [system.id] : []), ...beforeGoal.frontier])], advance: true });
    const recall = prepareRunRecall(beforeGoal, task, { maxNodes: this.config.projectionMaxNodes, targetTokens: this.config.projectionTargetTokens });
    const focus = await rankFocus(this.weave, this.config.focusReranker, task, options.signal);
    const run = new RunState(task, options, recall, focus);
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      options.signal?.throwIfAborted();
      const result = await this.step(run, iteration);
      if (result) return result;
    }
    return this.fail(run, `Agent recursion limit reached after ${this.config.maxIterations} iterations. Increase maxIterations to continue.`);
  }

  private async step(run: RunState, iteration: number): Promise<RuntimeResult | undefined> {
    const compiled = this.compileContext(run, iteration);
    const output = await this.callModel(run, compiled, iteration);
    const call = parseToolCall(output.text.replace(/^(\s*TOOL_CALL)\s*:\s*/i, "$1 "));
    if (call) return void (await this.runTool(run, iteration, compiled, output.text, call));
    const final = this.parseFinalOutput(run.task, output.text);
    if (!final) return void this.rejectInvalid(run, iteration, compiled, output.text);
    return this.finish(run, iteration, compiled, output.text, final);
  }

  private compileContext(run: RunState, iteration: number): CausalCompileResult {
    const { recall, projection } = run.recall;
    const { focus, preferredNodeIds } = run.focus;
    const compiled = this.weave.compile({ query: run.task, maxTokens: this.config.maxContextTokens, targetTokens: this.config.projectionTargetTokens, maxNodes: this.config.projectionMaxNodes, contextMode: this.config.contextMode, preferredNodeIds, recall: projection });
    run.latestCompiled = compiled;
    recall.visibleWindowIds = (projection?.windows ?? []).filter((window) => compiled.nodeIds.includes(window.nodeId) && compiled.prompt.includes(`[${window.id} ${window.start}:${window.end}]\n${window.text}`)).map((window) => window.id);
    if (focus) focus.selectedNodeIds = compiled.nodeIds.filter((id) => preferredNodeIds.includes(id));
    const contextTokens = compiled.tokenEstimate.estimatedTokens;
    this.progress(run, iteration, "context", this.contextDetail(run), { prompt: compiled.prompt, contextTokens, recall: structuredClone(recall), ...(focus ? { focus: structuredClone(focus) } : {}) });
    this.progress(run, iteration, "model", `Waiting for model iteration ${iteration}`, { contextTokens });
    return compiled;
  }

  private contextDetail(run: RunState): string {
    if (run.recall.recall.status === "lexical") return "Compiled locally selected source excerpts";
    if (run.focus.focus?.status === "fallback") return "Focus ranking unavailable; compiled the available context";
    return this.config.contextMode === "molecular" ? "Compiled the molecular context view" : "Compiled the active causal frontier";
  }

  private async callModel(run: RunState, compiled: CausalCompileResult, iteration: number): Promise<ModelOutput> {
    const input: ModelInput = {
      prompt: compiled.prompt,
      mode: "text",
      system: providerSystem(this.config.providerSystem, "Follow the supplied tool protocol exactly. Return one TOOL_CALL JSON object or one FINAL response."),
      signal: run.options.signal
    };
    const output = run.options.streamModel
      ? await collectStreamedModelOutput(this.config.model, input, iteration, run.options.onModelEvent)
      : await this.config.model.complete(input);
    run.usage.record(output, compiled.tokenEstimate.estimatedTokens);
    return output;
  }

  private parseFinalOutput(task: string, text: string): ParsedFinal | undefined {
    return parseFinal(text) ?? (this.tools.size === 0 ? parseTerminalNoToolFinal(text) : undefined) ?? parsePlainInformationalFinal(task, text);
  }

  private rejectInvalid(run: RunState, iteration: number, compiled: CausalCompileResult, text: string): void {
    const invalid = text.trim();
    const repeats = run.retry("invalid", invalid);
    const inference = this.weave.append({ kind: "inference", payload: invalid, parents: compiled.nodeIds, advance: true });
    const detail = /^\s*(?:TOOL_CALL|FINAL)\b/i.test(text)
      ? "The action JSON was malformed or truncated. Retry with one smaller valid TOOL_CALL or FINAL response."
      : "Planning prose is not an action. Return exactly one TOOL_CALL JSON object or one FINAL response.";
    this.weave.append({ kind: "protocol_error", payload: detail, parents: [inference.id], advance: true });
    run.trace.push(traceStep(iteration, compiled, text, "invalid", undefined, detail));
    this.progress(run, iteration, "retrying", `Invalid action · consecutive retries ${run.consecutiveRetries}/${MAX_RETRIES}`, { rawModelOutput: text, action: "invalid", error: detail });
    const shown = invalid.replace(/\s+/g, " ").slice(0, 240);
    if (repeats >= MAX_RETRIES) this.fail(run, `Agent repeated the same invalid action envelope ${MAX_RETRIES} times: ${shown}`);
    if (run.consecutiveRetries >= MAX_RETRIES) this.fail(run, `Agent stopped after ${MAX_RETRIES} consecutive retries; invalid action: ${shown}`);
    this.enforceNoProgress(run, iteration);
  }

  private finish(run: RunState, iteration: number, compiled: CausalCompileResult, text: string, final: ParsedFinal): RuntimeResult | undefined {
    const missingEvidence = this.config.enforceCompletionEvidence
      ? [...completionEvidenceGaps(run.evidenceTask, run.evidence, final.answer), ...completionAnswerGaps(run.evidenceTask, final.answer)]
      : [];
    if (missingEvidence.length) return void this.rejectUnsupported(run, iteration, compiled, text, final, missingEvidence.join(", "));
    const answerNode = this.weave.append({ kind: "answer", payload: final.answer, parents: compiled.nodeIds, advance: true });
    this.appendSemanticNodes(final.state, answerNode.id);
    run.trace.push(traceStep(iteration, compiled, text, "final"));
    this.progress(run, iteration, "final", "Agent produced a final answer", { rawModelOutput: text, action: "final" });
    const state = this.weave.snapshot();
    return { finalAnswer: final.answer, state, graph: this.visualGraph(run, state), trace: run.trace, metrics: run.metrics() };
  }

  private rejectUnsupported(run: RunState, iteration: number, compiled: CausalCompileResult, text: string, final: ParsedFinal, missing: string): void {
    const repeats = run.retry("unsupported", missing);
    const unsupported = this.weave.append({ kind: "inference", payload: { unsupportedFinal: final.answer }, parents: compiled.nodeIds, advance: true });
    this.weave.append({ kind: "protocol_error", payload: `Final is unsupported. Still required: ${missing}. Continue with one TOOL_CALL.`, parents: [unsupported.id], advance: true });
    run.trace.push(traceStep(iteration, compiled, text, "invalid", undefined, missing));
    this.progress(run, iteration, "retrying", `Final blocked · consecutive retries ${run.consecutiveRetries}/${MAX_RETRIES}: ${missing}`, { rawModelOutput: text, action: "invalid", error: missing });
    if (repeats >= MAX_RETRIES) this.fail(run, `Agent repeated an unsupported final ${MAX_RETRIES} times; missing evidence: ${missing}`);
    if (run.consecutiveRetries >= MAX_RETRIES) this.fail(run, `Agent stopped after ${MAX_RETRIES} consecutive retries; missing evidence: ${missing}`);
    this.enforceNoProgress(run, iteration);
  }

  private async runTool(run: RunState, iteration: number, compiled: CausalCompileResult, text: string, call: ToolCall): Promise<void> {
    run.resetRetries();
    const callNode = this.weave.append({ kind: "tool_call", payload: { name: call.name, args: call.args, raw: text }, parents: compiled.nodeIds, advance: true });
    this.progress(run, iteration, "tool", `Running ${call.name}`, { rawModelOutput: text, action: "tool", tool: call.name });
    run.options.signal?.throwIfAborted();
    const result = await executeAgentTool(this.tools, call);
    run.options.signal?.throwIfAborted();
    run.usage.toolCalls += 1;
    this.recordToolResult(run, iteration, callNode.id, call, result);
    run.trace.push(traceStep(iteration, compiled, text, "tool", call.name));
    this.progress(run, iteration, "context", `Recorded ${call.name} result`, { action: "tool", tool: call.name });
    this.enforceNoProgress(run, iteration);
  }

  private recordToolResult(run: RunState, iteration: number, callNodeId: string, call: ToolCall, result: unknown): void {
    const mutatedBefore = new Set(run.evidence.mutatedPaths);
    recordCompletionEvidence(run.evidence, call.name, call.args, result);
    const resultNode = this.weave.append({ kind: "tool_result", payload: { tool: call.name, result }, parents: [callNodeId], advance: true });
    this.appendSemanticNodes(call.state, resultNode.id);
    const verification = verificationRecord(call.name, call.args, result, mutatedBefore);
    if (verification) this.weave.append({ kind: "verification", payload: verification, parents: [resultNode.id], advance: true });
    for (const resource of resourceChanges(call.name, call.args, result)) {
      this.weave.append({ kind: "resource", payload: resource.payload, parents: [resultNode.id], resourceKey: resource.key, advance: true });
    }
    if (meaningfulMutationPaths(call.name, call.args, result).length) run.lastMutationIteration = iteration;
  }

  private enforceNoProgress(run: RunState, iteration: number): void {
    const limit = this.config.maxNoProgressIterations;
    if (limit && iteration - run.lastMutationIteration >= limit) {
      this.fail(run, `No successful workspace mutation occurred in ${limit} consecutive model iterations; the preserved state is attached to this error.`);
    }
  }

  private progress(run: RunState, iteration: number, phase: AgentProgress["phase"], detail: string, extra: Partial<AgentProgress> = {}): void {
    const { usage } = run;
    const includeGraph = phase === "context" || phase === "final" || phase === "retrying";
    run.options.onProgress?.({
      iteration,
      phase,
      modelCalls: usage.modelCalls,
      toolCalls: usage.toolCalls,
      totalInputTokens: usage.totalInputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.modelCalls ? { tokenCountSource: usage.tokenCountSource, peakContextTokens: usage.peakContextTokens } : {}),
      detail,
      ...(includeGraph ? { graph: this.visualGraph(run, this.weave.snapshot()) } : {}),
      ...extra
    });
  }

  private visualGraph(run: RunState, state: AgentState): StateGraph {
    const preferred = run.latestCompiled ? { preferredNodeIds: run.latestCompiled.nodeIds } : {};
    return projectCausalVisualSnapshot(state, { maxVisibleNodes: this.config.projectionMaxNodes, ...preferred }).graph;
  }

  private fail(run: RunState, message: string): never {
    const state = this.weave.snapshot();
    throw new AgentRunError(message, state, this.visualGraph(run, state), run.trace, run.metrics());
  }

  private appendSemanticNodes(inputs: SemanticNodeInput[], parentId: string): void {
    const allowed = new Set(this.config.nodeTypes.map((type) => type.name));
    for (const input of inputs) {
      const normalized = normalizeSemanticNode(input, allowed, this.config.allowDynamicNodeTypes);
      if (!normalized) continue;
      this.weave.append({ kind: "semantic", payload: normalized, parents: [parentId], resourceKey: `semantic:${normalized.type}:${normalized.key}`, advance: false });
    }
  }
}

export function normalizeNodeTypes(nodeTypes: SemanticNodeType[]): SemanticNodeType[] {
  const unique = new Map<string, SemanticNodeType>();
  for (const type of nodeTypes) {
    const name = normalizeSemanticName(type.name);
    const description = type.description.trim().slice(0, 240);
    if (!name || !description) throw new Error("Semantic node types require a lowercase name and description.");
    unique.set(name, { name, description });
  }
  if (!unique.size) throw new Error("Agent requires at least one semantic node type.");
  return [...unique.values()].slice(0, 32);
}

function parseTerminalNoToolFinal(text: string): ParsedFinal | undefined {
  if (/```|~~~|\bTOOL_CALL\b/i.test(text)) return undefined;
  const markers = [...text.matchAll(/^FINAL(?=\s|:|\{)/gim)];
  if (markers.length !== 1 || markers[0]!.index === 0) return undefined;
  return parseFinal(text.slice(markers[0]!.index));
}

function parsePlainInformationalFinal(task: string, output: string): ParsedFinal | undefined {
  const answer = output.trim();
  if (!answer || /^\s*(?:TOOL_CALL|FINAL)\b/i.test(answer)) return undefined;
  if (/\b(?:create|write|save|edit|update|modify|implement|build|fix|add|inspect|read|review|check|test|run|execute)\b/i.test(task)) return undefined;
  if (/^(?:not an action|invalid|planning prose|i(?:'| wi| a)?ll|let me|first,|sure,? i(?:'| wi)ll)\b/i.test(answer)) return undefined;
  return { answer, state: [] };
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

function normalizeSemanticNode(input: SemanticNodeInput, allowed: Set<string>, allowDynamic: boolean): SemanticNodeInput | undefined {
  const type = normalizeSemanticName(input.type);
  const key = normalizeSemanticKey(input.key);
  if (!type || !key || (!allowDynamic && !allowed.has(type))) return undefined;
  let encoded: string;
  try { encoded = JSON.stringify(input.content); } catch { return undefined; }
  if (encoded === undefined || encoded.length > 100_000) return undefined;
  return { type, key, content: structuredClone(input.content) };
}

function normalizeSemanticName(value: string): string {
  const name = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z][a-z0-9_-]{0,47}$/.test(name) ? name : "";
}

function normalizeSemanticKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_./:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
