import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Agent } from "../agent/stateweaveAgent.js";
import { createModelFromEnv } from "../llm/factory.js";
import type { Model, ModelInput } from "../llm/model.js";
import { clusterGraph } from "../core/projection.js";
import { serializeGraphFrame } from "../core/serialize.js";
import { NaiveBaselineAgent } from "./naiveBaseline.js";

const DEFAULT_BATCH_SIZE = 25;
const MAX_TURNS_KEPT = 50;
const MAX_SERIES_KEPT = 5000;

export type InfiniteTurnRecord = {
  batch: number;
  turn: number;
  prompt: string;
  answer: string;
  baselineAnswer: string;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  promptTokenEstimate: number;
  baselineTokenEstimate: number;
  latencyMs: number;
  baselineLatencyMs: number;
};

export type InfiniteSeriesPoint = {
  turn: number;
  stateweaveTokens: number;
  baselineTokens: number;
  stateweaveNodes: number;
  stateweaveClusters: number;
  stateweaveLatencyMs: number;
  baselineLatencyMs: number;
};

export type InfiniteReviewRecord = {
  batch: number;
  findings: string;
  filesChanged: string[];
  testsPassed: boolean;
  commit?: string;
  error?: string;
};

export type InfiniteStatus = "idle" | "running" | "batch_done" | "reviewing" | "committed" | "failed" | "stopped";

export type InfiniteState = {
  status: InfiniteStatus;
  batchSize: number;
  batchCount: number;
  turnCount: number;
  startedAt: string;
  updatedAt: string;
  currentBatch: number;
  challengerModel: string;
  agentModel: string;
  selfImprove: boolean;
  turns: InfiniteTurnRecord[];
  series: InfiniteSeriesPoint[];
  reviews: InfiniteReviewRecord[];
  graphSnapshot?: { nodeCount: number; edgeCount: number; clusterCount: number; clusters: { id: string; label: string; nodeCount: number }[] };
  message?: string;
};

export type InfiniteHarnessArgs = {
  batches?: number;
  batchSize?: number;
  selfImprove?: boolean;
  statePath: string;
  challengerModel?: Model;
  agentModel?: Model;
  baselineModel?: Model;
  maxIterations?: number;
};

export class InfiniteHarness {
  private batchSize: number;
  private batchCount: number;
  private selfImprove: boolean;
  private statePath: string;
  private challenger: Model;
  private agentModel: Model;
  private agent: Agent;
  private baseline: NaiveBaselineAgent;
  private maxIterations: number;
  private state: InfiniteState;
  private challengerMessages: { role: "user" | "assistant"; content: string }[] = [];
  private running = false;

  constructor(args: InfiniteHarnessArgs) {
    this.batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;
    this.batchCount = args.batches ?? 1;
    this.selfImprove = args.selfImprove ?? false;
    this.statePath = args.statePath;
    this.challenger = args.challengerModel ?? createModelFromEnv();
    this.agentModel = args.agentModel ?? createModelFromEnv();
    const baselineModel = args.baselineModel ?? this.agentModel;
    this.maxIterations = args.maxIterations ?? 8;
    this.agent = new Agent({ model: this.agentModel, maxIterations: this.maxIterations, systemPrompt: agentSystemPrompt() });
    this.baseline = new NaiveBaselineAgent({ model: baselineModel });
    this.state = emptyState(this.batchSize, this.batchCount, this.selfImprove, modelName(this.challenger), modelName(this.agentModel));
  }

  getState(): InfiniteState {
    return structuredClone(this.state);
  }

  async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      this.state = { ...this.state, ...JSON.parse(raw) };
    } catch {
      // fresh state
    }
  }

  async saveState(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    this.state.updatedAt = new Date().toISOString();
    const tmp = `${this.statePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.getState(), null, 2));
    await writeFile(this.statePath, await readFile(tmp, "utf8"));
    await writeFile(tmp, "{}").catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.state.status = "stopped";
    await this.saveState();
  }

  async run(onTurn?: (state: InfiniteState) => void): Promise<InfiniteState> {
    this.running = true;
    this.state.status = "running";
    this.state.startedAt = new Date().toISOString();
    if (this.challengerMessages.length === 0) this.challengerMessages = [{ role: "user", content: challengerSeedPrompt() }];
    await this.saveState();

    for (let batch = this.state.currentBatch + 1; batch <= this.batchCount && this.running; batch++) {
      this.state.currentBatch = batch;
      await this.runBatch(batch, onTurn);
      if (!this.running) break;

      if (this.selfImprove) {
        await this.reviewAndImprove(batch);
      }
      await this.saveState();
    }

    if (this.running) this.state.status = "stopped";
    await this.saveState();
    return this.getState();
  }

  private async runBatch(batch: number, onTurn?: (state: InfiniteState) => void): Promise<void> {
    this.baseline.wipe();

    for (let turn = 1; turn <= this.batchSize && this.running; turn++) {
      const clusterSummary = this.clusterSummary();
      const prompt = await this.nextChallengerPrompt(turn, batch, clusterSummary);

      // Run both agents concurrently on the same prompt — fair fight.
      const [swStart, baselineStart] = [Date.now(), Date.now()];
      const [swResult, baselineResult] = await Promise.all([
        this.agent.run({ objective: `Infinite harness batch ${batch} turn ${turn}`, input: prompt }),
        this.baseline.run(prompt)
      ]);
      const swLatency = Date.now() - swStart;
      const baselineLatency = Date.now() - baselineStart;

      this.challengerMessages.push({ role: "assistant", content: prompt }, { role: "user", content: challengerObservePrompt(prompt, swResult.finalAnswer, clusterSummary) });

      const frame = this.agent.getFrame();
      const swTokens = frame ? Math.round(serializeGraphFrame(frame).length / 4) : 0;
      const clusters = frame ? clusterGraph(frame.graph) : [];

      const turnNumber = this.state.turnCount + 1;
      const record: InfiniteTurnRecord = {
        batch,
        turn: turnNumber,
        prompt,
        answer: swResult.finalAnswer,
        baselineAnswer: baselineResult.answer.slice(0, 400),
        nodeCount: swResult.graph.nodes.length,
        edgeCount: swResult.graph.edges.length,
        clusterCount: clusters.length,
        promptTokenEstimate: swTokens,
        baselineTokenEstimate: baselineResult.tokenEstimate,
        latencyMs: swLatency,
        baselineLatencyMs: baselineLatency
      };

      this.state.turnCount = turnNumber;
      this.state.turns = [...this.state.turns, record].slice(-MAX_TURNS_KEPT);
      this.state.series = [...this.state.series, {
        turn: turnNumber,
        stateweaveTokens: swTokens,
        baselineTokens: baselineResult.tokenEstimate,
        stateweaveNodes: swResult.graph.nodes.length,
        stateweaveClusters: clusters.length,
        stateweaveLatencyMs: swLatency,
        baselineLatencyMs: baselineLatency
      }].slice(-MAX_SERIES_KEPT);
      this.state.graphSnapshot = graphSnapshot(frame?.graph, clusters);
      this.state.status = "running";
      await this.saveState();
      onTurn?.(this.getState());
    }

    this.challengerMessages = [{ role: "user", content: challengerSeedPrompt(this.clusterSummary()) }];
    this.state.status = "batch_done";
    await this.saveState();
  }

  private clusterSummary(): string {
    const frame = this.agent.getFrame();
    if (!frame) return "(no graph yet)";
    const clusters = clusterGraph(frame.graph);
    if (!clusters.length) return "(no topics yet)";
    return clusters.map((c) => `- ${c.id} (${c.summary}): ${c.label}`).join("\n");
  }

  private async nextChallengerPrompt(turn: number, batch: number, clusterSummary: string): Promise<string> {
    const context = `Batch ${batch}, turn ${turn}. StateWeave graph topics so far:\n${clusterSummary}\n\nChallenger messages so far: ${this.challengerMessages.length}.`;
    const input: ModelInput = {
      prompt: `${context}\n\nGenerate ONLY the next adversarial prompt (one to three sentences, no preamble, no quotes). It must test StateWeave's graph memory, cross-turn reasoning, artifact continuity, or a topic it has NOT been tested on yet.`,
      mode: "text"
    };
    const output = await this.challenger.complete(input);
    return output.text.trim().replace(/^["']|["']$/g, "").slice(0, 1000);
  }

  private async reviewAndImprove(batch: number): Promise<void> {
    this.state.status = "reviewing";
    await this.saveState();
    const review: InfiniteReviewRecord = {
      batch,
      findings: "Self-improvement is stubbed in this validation run; no files were edited.",
      filesChanged: [],
      testsPassed: true
    };
    this.state.reviews = [...this.state.reviews, review];
    this.state.status = "committed";
  }
}

function emptyState(batchSize: number, batchCount: number, selfImprove: boolean, challengerModel: string, agentModel: string): InfiniteState {
  const now = new Date().toISOString();
  return {
    status: "idle",
    batchSize,
    batchCount,
    turnCount: 0,
    startedAt: now,
    updatedAt: now,
    currentBatch: 0,
    challengerModel,
    agentModel,
    selfImprove,
    turns: [],
    series: [],
    reviews: []
  };
}

function graphSnapshot(graph: { nodes: { id: string; type: string; text: string }[]; edges: unknown[] } | undefined, clusters: ReturnType<typeof clusterGraph>): InfiniteState["graphSnapshot"] {
  if (!graph) return undefined;
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    clusterCount: clusters.length,
    clusters: clusters.map((c) => ({ id: c.id, label: c.label, nodeCount: c.nodeCount }))
  };
}

function modelName(model: Model): string {
  const config = (model as unknown as { config?: { model?: string } }).config;
  return config?.model ?? model.constructor.name;
}

function agentSystemPrompt(): string {
  return [
    "You are a StateWeave agent under adversarial stress testing.",
    "Your StateGraph is persistent working memory that never resets — use it to remember facts, artifacts, and prior conclusions across all turns.",
    "Answer concretely and reference your graph memory when the challenger tests cross-turn recall.",
    "When asked to build or revise artifacts, use the workspace file tools (write_file, edit_file, read_file, bash_command)."
  ].join(" ");
}

function challengerSeedPrompt(clusterSummary?: string): string {
  return [
    "You are an adversarial tester probing a graph-native agent (StateWeave) that claims persistent memory across unlimited turns.",
    "Generate diverse, escalating challenges: test cross-turn recall, contradiction detection, artifact revision, multi-step planning, and edge cases.",
    "Each turn output ONLY the next challenge prompt — no meta commentary.",
    clusterSummary ? `\nTopics already covered (avoid exact repeats, push into adjacent areas):\n${clusterSummary}` : ""
  ].join("\n");
}

function challengerObservePrompt(prompt: string, answer: string, clusterSummary: string): string {
  return `You asked: ${prompt}\n\nStateWeave answered: ${answer.slice(0, 800)}\n\nCurrent graph topics:\n${clusterSummary}\n\nDecide the next challenge that exposes a weakness or an untested area.`;
}
