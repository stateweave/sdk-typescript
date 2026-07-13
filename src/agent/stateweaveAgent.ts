import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendInputToGraphFrame, cloneFrame, createInitialGraphFrame, forkFrame } from "../core/graph.js";
import { normalizeTaskInput } from "../core/input.js";
import type { AgentResult, GraphEdge, GraphFrame, GraphNode, StateGraph, StateWeaveStreamEvent, TraceStep } from "../core/types.js";
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
  systemPrompt?: string;
  nodeTypes?: string[];
  traceDir?: string;
  frame?: GraphFrame;
};

export class StateWeaveAgent {
  private model: Model;
  private tools: Tool[];
  private maxIterations: number;
  private systemPrompt?: string;
  private nodeTypes: string[];
  private traceDir?: string;
  private frame?: GraphFrame;
  private stateLock: Promise<void> = Promise.resolve();

  constructor(args: StateWeaveAgentArgs) {
    this.model = args.model;
    this.tools = args.tools ?? createDefaultTools();
    this.maxIterations = args.maxIterations ?? defaultMaxIterations;
    this.systemPrompt = args.systemPrompt;
    this.nodeTypes = normalizeNodeTypes(args.nodeTypes ?? []);
    this.traceDir = args.traceDir;
    this.frame = args.frame ? cloneFrame(args.frame) : undefined;
  }

  async run(input: StateWeaveInput, options?: StateWeaveRunOptions): Promise<AgentResult> {
    if (options?.frame) return this.runOnce(input, options);

    const baseFrame = await this.reserveFrame(input);
    const result = await this.runOnce(input, { ...options, frame: baseFrame, inputAlreadyAppended: true });
    return this.commitResult(result, baseFrame);
  }

  async *stream(input: StateWeaveInput, options?: StateWeaveRunOptions): AsyncIterable<StateWeaveStreamEvent> {
    if (options?.frame) {
      yield* this.streamOnce(input, options);
      return;
    }

    const baseFrame = await this.reserveFrame(input);
    for await (const event of this.streamOnce(input, { ...options, frame: baseFrame, inputAlreadyAppended: true })) {
      if (event.type !== "final") {
        yield event;
        continue;
      }
      const committed = await this.commitResult(event.result, baseFrame);
      yield { ...event, result: committed };
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
    this.frame = frame ? cloneFrame(frame) : undefined;
  }

  private async reserveFrame(input: StateWeaveInput): Promise<GraphFrame> {
    const task = normalizeTaskInput(input);
    return this.withStateLock(() => {
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
      this.frame = next;
      return forkFrame(next);
    });
  }

  private async runOnce(input: StateWeaveInput, options: StateWeaveRunOptions | undefined): Promise<AgentResult> {
    try {
      const result = await runStateWeave({ model: this.model, tools: this.tools, maxIterations: this.maxIterations, systemPrompt: this.systemPrompt, nodeTypes: this.nodeTypes }, input, options);
      if (this.traceDir) await this.saveTrace(traceObjective(result.trace), result.trace);
      return result;
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private async *streamOnce(input: StateWeaveInput, options: StateWeaveRunOptions | undefined): AsyncIterable<StateWeaveStreamEvent> {
    try {
      for await (const event of streamStateWeave({ model: this.model, tools: this.tools, maxIterations: this.maxIterations, systemPrompt: this.systemPrompt, nodeTypes: this.nodeTypes }, input, options)) {
        if (event.type === "final" && this.traceDir) await this.saveTrace(traceObjective(event.result.trace), event.result.trace);
        yield event;
      }
    } catch (error) {
      if (this.traceDir && error instanceof StateWeaveRunError) await this.saveTrace(traceObjective(error.trace), error.trace);
      throw error;
    }
  }

  private async commitResult(result: AgentResult, baseFrame: GraphFrame): Promise<AgentResult> {
    return this.withStateLock(() => {
      const frame = mergeConcurrentFrame(this.frame ?? baseFrame, result.frame, baseFrame);
      this.frame = frame;
      return { ...result, frame, graph: frame.graph };
    });
  }

  private toolActions(): string[] {
    return this.tools.map((tool) => `tool:${tool.name} - ${tool.description}`);
  }

  private async withStateLock<T>(work: () => T | Promise<T>): Promise<T> {
    const previous = this.stateLock.catch(() => undefined);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.stateLock = previous.then(() => current);
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
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

function mergeConcurrentFrame(currentFrame: GraphFrame, resultFrame: GraphFrame, baseFrame: GraphFrame): GraphFrame {
  const next = forkFrame(currentFrame);
  const baseNodeIds = new Set(baseFrame.graph.nodes.map((node) => node.id));
  const baseEdgeKeys = new Set(baseFrame.graph.edges.map(edgeKey));
  const nodeRenames = new Map<string, string>();
  const newResultNodes = resultFrame.graph.nodes.filter((node) => !baseNodeIds.has(node.id));

  for (const node of newResultNodes) {
    if (!next.graph.nodes.some((item) => item.id === node.id)) continue;
    nodeRenames.set(node.id, uniqueNodeId(next.graph, node.id));
  }

  for (const node of newResultNodes) {
    const id = nodeRenames.get(node.id) ?? node.id;
    if (next.graph.nodes.some((item) => item.id === id)) continue;
    next.graph.nodes.push(rewriteNode(node, id, nodeRenames));
  }

  for (const edge of resultFrame.graph.edges) {
    if (baseEdgeKeys.has(edgeKey(edge))) continue;
    const rewritten = rewriteEdge(edge, nodeRenames);
    if (!hasNode(next.graph, rewritten.from) || !hasNode(next.graph, rewritten.to)) continue;
    if (next.graph.edges.some((item) => edgeKey(item) === edgeKey(rewritten))) continue;
    next.graph.edges.push({ ...rewritten, id: uniqueEdgeId(next.graph, rewritten) });
  }

  next.frame.currentFocus = resultFrame.frame.currentFocus;
  next.frame.focusNodeId = rewriteOptionalId(resultFrame.frame.focusNodeId, nodeRenames) ?? next.frame.focusNodeId;
  next.frame.activeUserInputNodeId = rewriteOptionalId(resultFrame.frame.activeUserInputNodeId, nodeRenames) ?? next.frame.activeUserInputNodeId;
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...resultFrame.frame.activeConstraints]);
  next.frame.nodeTypes = normalizeNodeTypes([...(next.frame.nodeTypes ?? []), ...(resultFrame.frame.nodeTypes ?? [])]);
  next.frame.candidateFocusNodeIds = unique([
    ...(next.frame.candidateFocusNodeIds ?? []),
    ...(resultFrame.frame.candidateFocusNodeIds ?? []).map((id) => nodeRenames.get(id) ?? id),
    ...newResultNodes.map((node) => nodeRenames.get(node.id) ?? node.id)
  ]).filter((id) => hasNode(next.graph, id));
  if (!resultFrame.frame.lastGraphOpsError) delete next.frame.lastGraphOpsError;

  return next;
}

function rewriteNode(node: GraphNode, id: string, renames: Map<string, string>): GraphNode {
  return { ...node, id, data: rewriteValue(node.data, renames) as Record<string, unknown> | undefined };
}

function rewriteEdge(edge: GraphEdge, renames: Map<string, string>): GraphEdge {
  return { ...edge, from: renames.get(edge.from) ?? edge.from, to: renames.get(edge.to) ?? edge.to };
}

function rewriteValue(value: unknown, renames: Map<string, string>): unknown {
  if (typeof value === "string") return renames.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, renames));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteValue(item, renames)]));
}

function rewriteOptionalId(id: string | undefined, renames: Map<string, string>): string | undefined {
  return id ? renames.get(id) ?? id : undefined;
}

function uniqueNodeId(graph: StateGraph, id: string): string {
  let index = 2;
  let next = `${id}_${index}`;
  while (graph.nodes.some((node) => node.id === next)) {
    index += 1;
    next = `${id}_${index}`;
  }
  return next;
}

function uniqueEdgeId(graph: StateGraph, edge: Pick<GraphEdge, "from" | "type" | "to">): string {
  const base = `edge_${edge.from}_${edge.type}_${edge.to}`.replace(/[^a-zA-Z0-9_]/g, "_");
  let next = base;
  let index = 2;
  while (graph.edges.some((item) => item.id === next)) {
    next = `${base}_${index}`;
    index += 1;
  }
  return next;
}

function edgeKey(edge: Pick<GraphEdge, "from" | "type" | "to">): string {
  return `${edge.from}\u0000${edge.type}\u0000${edge.to}`;
}

function hasNode(graph: StateGraph, id: string): boolean {
  return graph.nodes.some((node) => node.id === id);
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
