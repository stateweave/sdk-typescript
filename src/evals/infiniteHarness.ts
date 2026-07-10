import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createModelFromEnv } from "../llm/factory.js";
import type { Model, ModelInput } from "../llm/model.js";
import { clusterGraph } from "../core/projection.js";
import { serializeGraphFrame } from "../core/serialize.js";
import { GraphMemoryAgent } from "./graphMemoryAgent.js";
import { NaiveBaselineAgent } from "./naiveBaseline.js";

const MAX_TURNS_KEPT = 60;
const MAX_SERIES_KEPT = 5000;
const SEED_INTERVAL = 6;
const CONSISTENCY_EVERY = 20;
const WINDOWED_BUDGET_TOKENS = 12000;
// Naive baseline gets a realistic context budget: at long horizons the transcript
// outgrows any real model's usable window and old facts are dropped. SW never
// compacts (append-only graph + disposable projection), so this is the gap the
// harness is designed to expose. 16k models a typical production agent's usable
// budget (after system prompt, tools, instructions eat most of the window).
const NAIVE_FULL_BUDGET_TOKENS = 16000;
const CALL_TIMEOUT_MS = 90_000; // 90s hard limit per model call

export type ProbeScore = { score: "pass" | "partial" | "fail"; reasoning: string };

export type SeedRecord = { turn: number; prompt: string; facts: string[] };

export type ProbeRecord = {
  turn: number;
  prompt: string;
  goldAnswer: string;
  assertions: string[];
  difficulty: string;
  dependsOnTurn: number;
  scores: { stateweave: ProbeScore; naive: ProbeScore; windowed: ProbeScore };
};

export type ConsistencyCheck = {
  originalTurn: number;
  reaskTurn: number;
  prompt: string;
  goldAnswer: string;
  originalAnswer: string;
  newAnswer: string;
  matchesOriginal: boolean;
  matchesGold: ProbeScore;
};

export type QualityPoint = {
  turn: number;
  stateweavePassRate: number;
  naivePassRate: number;
  windowedPassRate: number;
  stateweaveScored: number;
  naiveScored: number;
  windowedScored: number;
};

export type InfiniteTurnRecord = {
  batch: number;
  turn: number;
  phase: "seed" | "probe" | "consistency";
  prompt: string;
  answer: string;
  baselineAnswer: string;
  windowedAnswer: string;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  promptTokenEstimate: number;
  baselineTokenEstimate: number;
  windowedTokenEstimate: number;
  latencyMs: number;
  baselineLatencyMs: number;
  windowedLatencyMs: number;
  transactionValid: boolean;
  transactionError?: string;
  score?: { stateweave: ProbeScore; naive: ProbeScore; windowed: ProbeScore };
};

export type InfiniteFinalReport = {
  generatedAt: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  categoryBreakdown: { difficulty: string; stateweavePassRate: number; naivePassRate: number; windowedPassRate: number; count: number }[];
  driftInstances: { turn: number; description: string }[];
  verdict: string;
};

export type InfiniteStatus = "idle" | "running" | "batch_done" | "reviewing" | "committed" | "failed" | "stopped" | "reporting";

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
  series: Array<{ turn: number; stateweaveTokens: number; baselineTokens: number; windowedTokens: number; stateweaveNodes: number; stateweaveClusters: number; stateweaveLatencyMs: number; baselineLatencyMs: number; windowedLatencyMs: number }>;
  qualitySeries: QualityPoint[];
  seeds: SeedRecord[];
  probes: ProbeRecord[];
  consistencyChecks: ConsistencyCheck[];
  reviews: Array<{ batch: number; findings: string; filesChanged: string[]; testsPassed: boolean }>;
  finalReport?: InfiniteFinalReport;
  graphSnapshot?: { nodeCount: number; edgeCount: number; clusterCount: number; clusters: { id: string; label: string; nodeCount: number }[] };
  message?: string;
};

export type InfiniteReplayTurn = {
  turn: number;
  phase: "seed" | "probe" | "consistency";
  prompt: string;
  probe?: Pick<ProbeRecord, "goldAnswer" | "assertions" | "difficulty" | "dependsOnTurn"> & { baselineScore: ProbeScore };
};

export type InfiniteHarnessArgs = {
  batches?: number;
  batchSize?: number;
  selfImprove?: boolean;
  statePath: string;
  challengerModel?: Model;
  agentModel?: Model;
  maxIterations?: number;
};

export class InfiniteHarness {
  private batchSize: number;
  private batchCount: number;
  private selfImprove: boolean;
  private statePath: string;
  private challenger: Model;
  private agentModel: Model;
  private agent: GraphMemoryAgent;
  private naive: NaiveBaselineAgent;
  private windowed: NaiveBaselineAgent;
  private maxIterations: number;
  private replayPath: string;
  private state: InfiniteState;
  private ledger: SeedRecord[] = [];
  private askedProbeStems: Set<string> = new Set();
  private running = false;

  constructor(args: InfiniteHarnessArgs) {
    this.batchSize = args.batchSize ?? 50;
    this.batchCount = args.batches ?? 1;
    this.selfImprove = args.selfImprove ?? false;
    this.statePath = args.statePath;
    this.challenger = args.challengerModel ?? createModelFromEnv();
    this.agentModel = args.agentModel ?? createModelFromEnv();
    this.maxIterations = args.maxIterations ?? 3;
    this.replayPath = `${this.statePath}.replay.jsonl`;
    this.agent = new GraphMemoryAgent({ model: this.agentModel, systemPrompt: agentSystemPrompt() });
    this.naive = new NaiveBaselineAgent({ model: this.agentModel, variant: "full", maxContextTokens: NAIVE_FULL_BUDGET_TOKENS });
    this.windowed = new NaiveBaselineAgent({ model: this.agentModel, variant: "windowed", maxContextTokens: WINDOWED_BUDGET_TOKENS });
    this.state = emptyState(this.batchSize, this.batchCount, this.selfImprove, modelName(this.challenger), modelName(this.agentModel));
  }

  getState(): InfiniteState { return structuredClone(this.state); }

  async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      this.state = { ...this.state, ...JSON.parse(raw) };
      this.ledger = this.state.seeds ?? [];
    } catch { /* fresh */ }
  }

  async saveState(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    this.state.updatedAt = new Date().toISOString();
    await writeFile(this.statePath, JSON.stringify(this.getState(), null, 2));
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
    await writeFile(this.replayPath, "");
    await this.saveState();

    for (let batch = this.state.currentBatch + 1; batch <= this.batchCount && this.running; batch++) {
      this.state.currentBatch = batch;
      await this.runBatch(batch, onTurn);
      if (!this.running) break;
      await this.saveState();
    }

    if (this.running) {
      await this.generateFinalReport();
      this.state.status = "stopped";
    }
    await this.saveState();
    return this.getState();
  }

  private async runBatch(batch: number, onTurn?: (state: InfiniteState) => void): Promise<void> {
    this.naive.wipe();
    this.windowed.wipe();

    for (let turn = 1; turn <= this.batchSize && this.running; turn++) {
      const globalTurn = this.state.turnCount + 1;
      const phase = this.phaseFor(globalTurn, this.batchSize);
      await this.runTurn(batch, globalTurn, turn, phase);
      await this.appendReplayTurn(globalTurn, phase);
      // Persist after every turn so external watchers (worker push_state)
      // see live, turn-by-turn progress instead of waiting for completion.
      await this.saveState();
      onTurn?.(this.getState());
    }

    this.naive.wipe();
    this.windowed.wipe();
    this.state.status = "batch_done";
    await this.saveState();
  }

  private phaseFor(globalTurn: number, batchSize: number): "seed" | "probe" | "consistency" {
    if (globalTurn === 1 || (globalTurn - 1) % SEED_INTERVAL === 0) return "seed";
    if (globalTurn % CONSISTENCY_EVERY === 0 && globalTurn > 10) {
      const oldProbes = this.state.probes.filter((p) => p.turn <= globalTurn - 10);
      if (oldProbes.length) return "consistency";
    }
    return "probe";
  }

  private async runTurn(batch: number, globalTurn: number, localTurn: number, phase: "seed" | "probe" | "consistency"): Promise<void> {
    try {
      if (phase === "seed") {
        const seed = await this.generateSeed(globalTurn);
        const result = await this.runAllAgents(seed.prompt);
        this.ledger.push(seed);
        this.state.seeds = [...this.ledger];
        this.recordTurn(batch, globalTurn, "seed", seed.prompt, result, undefined);
        return;
      }

      if (phase === "consistency") {
        const target = this.pickConsistencyTarget(globalTurn);
        if (target) {
          const result = await this.runAllAgents(target.prompt);
          const swAnswer = result.stateweave.answer;
          const check: ConsistencyCheck = {
            originalTurn: target.turn,
            reaskTurn: globalTurn,
            prompt: target.prompt,
            goldAnswer: target.goldAnswer,
            originalAnswer: this.originalAnswerFor(target.turn),
            newAnswer: swAnswer,
            matchesOriginal: false,
            matchesGold: await this.judgeScore(target.prompt, target.assertions, target.goldAnswer, swAnswer)
          };
          check.matchesOriginal = await this.judgeAgreement(target.prompt, this.originalAnswerFor(target.turn), swAnswer);
          this.state.consistencyChecks = [...this.state.consistencyChecks, check];
          this.recordTurn(batch, globalTurn, "consistency", target.prompt, result, undefined);
          return;
        }
      }

      // probe
      const probe = await this.generateProbe(globalTurn);
      const result = await this.runAllAgents(probe.prompt);
      const [swScore, naiveScore, windowedScore] = await Promise.all([
        this.judgeScore(probe.prompt, probe.assertions, probe.goldAnswer, result.stateweave.answer),
        this.judgeScore(probe.prompt, probe.assertions, probe.goldAnswer, result.naive.answer),
        this.judgeScore(probe.prompt, probe.assertions, probe.goldAnswer, result.windowed.answer)
      ]);
      const scores = { stateweave: swScore, naive: naiveScore, windowed: windowedScore };
      const probeRecord: ProbeRecord = { turn: globalTurn, prompt: probe.prompt, goldAnswer: probe.goldAnswer, assertions: probe.assertions, difficulty: probe.difficulty, dependsOnTurn: probe.dependsOnTurn, scores };
      this.state.probes = [...this.state.probes, probeRecord];
      this.updateQualitySeries();
      this.recordTurn(batch, globalTurn, "probe", probe.prompt, result, scores);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.message = `Turn ${globalTurn} skipped: ${message.slice(0, 120)}`;
      await this.saveState();
      // Clear the error after a few seconds so it doesn't persist.
      setTimeout(() => { if (this.state.message === `Turn ${globalTurn} skipped: ${message.slice(0, 120)}`) this.state.message = undefined; }, 5000);
    }
  }

  private async appendReplayTurn(turn: number, phase: "seed" | "probe" | "consistency"): Promise<void> {
    const record = this.state.turns.find((item) => item.turn === turn);
    if (!record) return;
    const probe = this.state.probes.find((item) => item.turn === turn);
    const replay: InfiniteReplayTurn = {
      turn,
      phase,
      prompt: record.prompt,
      ...(probe ? { probe: {
        goldAnswer: probe.goldAnswer,
        assertions: probe.assertions,
        difficulty: probe.difficulty,
        dependsOnTurn: probe.dependsOnTurn,
        baselineScore: probe.scores.stateweave
      } } : {})
    };
    await appendFile(this.replayPath, `${JSON.stringify(replay)}\n`);
  }

  private originalAnswerFor(turn: number): string {
    return this.state.turns.find((t) => t.turn === turn)?.answer ?? "";
  }

  private async runAllAgents(prompt: string): Promise<{ stateweave: { answer: string; latencyMs: number; transactionValid: boolean; transactionError?: string }; naive: { answer: string; latencyMs: number; tokenEstimate: number }; windowed: { answer: string; latencyMs: number; tokenEstimate: number } }> {
    // Run agents SEQUENTIALLY (not Promise.allSettled) to cap peak memory on
    // small VPS hosts. Each call is still individually guarded by withTimeout.
    const swResult = await withTimeout((async () => { const start = Date.now(); const r = await this.agent.run(prompt); return { answer: r.answer, latencyMs: Date.now() - start, transactionValid: r.transactionValid, transactionError: r.transactionError }; })(), CALL_TIMEOUT_MS, "SW agent").then(v => ({ status: "fulfilled" as const, value: v }), () => ({ status: "rejected" as const, reason: undefined }));
    const nResult = await withTimeout((async () => { const start = Date.now(); const r = await this.naive.run(prompt); return { answer: r.answer, latencyMs: Date.now() - start, tokenEstimate: r.tokenEstimate }; })(), CALL_TIMEOUT_MS, "naive").then(v => ({ status: "fulfilled" as const, value: v }), () => ({ status: "rejected" as const, reason: undefined }));
    const wResult = await withTimeout((async () => { const start = Date.now(); const r = await this.windowed.run(prompt); return { answer: r.answer, latencyMs: Date.now() - start, tokenEstimate: r.tokenEstimate }; })(), CALL_TIMEOUT_MS, "windowed").then(v => ({ status: "fulfilled" as const, value: v }), () => ({ status: "rejected" as const, reason: undefined }));
    return {
      stateweave: swResult.status === "fulfilled" ? swResult.value : { answer: "(timeout)", latencyMs: CALL_TIMEOUT_MS, transactionValid: false, transactionError: "timeout" },
      naive: nResult.status === "fulfilled" ? nResult.value : { answer: "(timeout)", latencyMs: CALL_TIMEOUT_MS, tokenEstimate: 0 },
      windowed: wResult.status === "fulfilled" ? wResult.value : { answer: "(timeout)", latencyMs: CALL_TIMEOUT_MS, tokenEstimate: 0 }
    };
  }

  private recordTurn(batch: number, globalTurn: number, phase: "seed" | "probe" | "consistency", prompt: string, result: { stateweave: { answer: string; latencyMs: number; transactionValid: boolean; transactionError?: string }; naive: { answer: string; latencyMs: number; tokenEstimate: number }; windowed: { answer: string; latencyMs: number; tokenEstimate: number } }, score: { stateweave: ProbeScore; naive: ProbeScore; windowed: ProbeScore } | undefined): void {
    const frame = this.agent.getFrame();
    const swTokens = frame ? Math.round(serializeGraphFrame(frame).length / 4) : 0;
    const clusters = frame ? clusterGraph(frame.graph) : [];
    this.state.turnCount = globalTurn;
    const record: InfiniteTurnRecord = {
      batch, turn: globalTurn, phase, prompt,
      answer: result.stateweave.answer,
      baselineAnswer: result.naive.answer.slice(0, 500),
      windowedAnswer: result.windowed.answer.slice(0, 500),
      nodeCount: frame?.graph.nodes.length ?? 0,
      edgeCount: frame?.graph.edges.length ?? 0,
      clusterCount: clusters.length,
      promptTokenEstimate: swTokens,
      baselineTokenEstimate: result.naive.tokenEstimate,
      windowedTokenEstimate: result.windowed.tokenEstimate,
      latencyMs: result.stateweave.latencyMs,
      baselineLatencyMs: result.naive.latencyMs,
      windowedLatencyMs: result.windowed.latencyMs,
      transactionValid: result.stateweave.transactionValid,
      ...(result.stateweave.transactionError ? { transactionError: result.stateweave.transactionError } : {}),
      score
    };
    this.state.turns = [...this.state.turns, record].slice(-MAX_TURNS_KEPT);
    this.state.series = [...this.state.series, {
      turn: globalTurn, stateweaveTokens: swTokens, baselineTokens: result.naive.tokenEstimate, windowedTokens: result.windowed.tokenEstimate,
      stateweaveNodes: frame?.graph.nodes.length ?? 0, stateweaveClusters: clusters.length,
      stateweaveLatencyMs: result.stateweave.latencyMs, baselineLatencyMs: result.naive.latencyMs, windowedLatencyMs: result.windowed.latencyMs
    }].slice(-MAX_SERIES_KEPT);
    this.state.graphSnapshot = graphSnapshot(frame?.graph, clusters);
  }

  private updateQualitySeries(): void {
    const probes = this.state.probes;
    if (!probes.length) return;
    const score = (s: ProbeScore) => (s.score === "pass" ? 1 : s.score === "partial" ? 0.5 : 0);
    const rate = (arr: ProbeScore[]) => arr.length ? arr.reduce((a, b) => a + score(b), 0) / arr.length : 0;
    const sw = probes.map((p) => p.scores.stateweave);
    const n = probes.map((p) => p.scores.naive);
    const w = probes.map((p) => p.scores.windowed);
    this.state.qualitySeries = [...this.state.qualitySeries, {
      turn: probes[probes.length - 1].turn,
      stateweavePassRate: rate(sw), naivePassRate: rate(n), windowedPassRate: rate(w),
      stateweaveScored: sw.length, naiveScored: n.length, windowedScored: w.length
    }].slice(-MAX_SERIES_KEPT);
  }

  // --- Challenger generation ---

  private async generateSeed(turn: number): Promise<SeedRecord> {
    const existing = this.ledger.length;
    const input: ModelInput = {
      prompt: `Turn ${turn}. Generate a SEED that plants 3 to 5 memorable, distinct facts a memory system must retain. Each fact must be specific (a name, number, color, relation, or rule) so it can be probed later. Output ONLY JSON:\n{"prompt":"<the natural-language seed message the agent receives>","facts":["<fact1>","<fact2>","<fact3>"]}\nSeeds so far: ${existing}. Vary the domain (avoid repeating prior topics).`,
      mode: "text"
    };
    try {
      const out = await withTimeout(this.challenger.complete(input), CALL_TIMEOUT_MS, "seed gen");
      const parsed = extractJson(out.text) as { prompt?: string; facts?: string[] };
      if (parsed.prompt && Array.isArray(parsed.facts) && parsed.facts.length) {
        return { turn, prompt: String(parsed.prompt), facts: parsed.facts.map(String) };
      }
    } catch { /* fall through */ }
    return fallbackSeed(turn);
  }

  private async generateProbe(turn: number): Promise<{ prompt: string; goldAnswer: string; assertions: string[]; difficulty: string; dependsOnTurn: number }> {
    const eligible = this.ledger.filter((s) => s.turn <= turn - 2);
    if (!eligible.length) {
      const seed = await this.generateSeed(turn);
      this.ledger.push(seed);
      this.state.seeds = [...this.ledger];
      eligible.push(seed);
    }
    const target = eligible[Math.floor(Math.random() * eligible.length)];
    const difficulty = pickDifficulty(turn);
    const fact = target.facts[Math.floor(Math.random() * target.facts.length)];
    const input: ModelInput = {
      prompt: `You are probing recall of a fact planted at turn ${target.turn}. The planted fact is: "${fact}" (from seed: "${target.prompt.slice(0, 120)}"). Difficulty: ${difficulty} (${difficultyHint(difficulty)}). Output ONLY JSON:\n{"prompt":"<a question the agent must answer>","goldAnswer":"<correct answer>","assertions":["<key phrase the answer must contain>"]}\nDo NOT repeat the fact verbatim in the prompt. Make it require recall.`,
      mode: "text"
    };
    try {
      const out = await withTimeout(this.challenger.complete(input), CALL_TIMEOUT_MS, "probe gen");
      const parsed = extractJson(out.text) as { prompt?: string; goldAnswer?: string; assertions?: string[] };
      if (parsed.prompt && parsed.goldAnswer) {
        const stem = String(parsed.prompt).toLowerCase().slice(0, 40);
        if (this.askedProbeStems.has(stem)) return this.generateProbe(turn);
        this.askedProbeStems.add(stem);
        return { prompt: String(parsed.prompt), goldAnswer: String(parsed.goldAnswer), assertions: Array.isArray(parsed.assertions) ? parsed.assertions.map(String) : [String(parsed.goldAnswer)], difficulty, dependsOnTurn: target.turn };
      }
    } catch { /* fall through */ }
    return { prompt: `Recall: what was established as "${fact}"?`, goldAnswer: fact, assertions: [fact], difficulty, dependsOnTurn: target.turn };
  }

  private pickConsistencyTarget(turn: number): ProbeRecord | undefined {
    const old = this.state.probes.filter((p) => p.turn <= turn - 10);
    return old[old.length - 1];
  }

  private async judgeScore(prompt: string, assertions: string[], gold: string, answer: string): Promise<ProbeScore> {
    const input: ModelInput = {
      prompt: `You are a strict grader. Score the agent's answer.\nQuestion: ${prompt}\nKey assertions the answer must include: ${JSON.stringify(assertions)}\nGold reference: ${gold}\nAgent answer: ${answer.slice(0, 1500)}\nOutput ONLY JSON: {"score":"pass"|"partial"|"fail","reasoning":"one short sentence"}\nRules: pass = answer contains the essential correct fact(s). partial = vague or missing detail. fail = wrong, evasive, or hallucinated.`,
      mode: "text"
    };
    try {
      const out = await withTimeout(this.challenger.complete(input), CALL_TIMEOUT_MS, "judge score");
      const parsed = extractJson(out.text) as { score?: string; reasoning?: string };
      const score = parsed.score === "pass" ? "pass" : parsed.score === "partial" ? "partial" : parsed.score === "fail" ? "fail" : "fail";
      return { score, reasoning: String(parsed.reasoning ?? score).slice(0, 200) };
    } catch {
      return { score: "fail", reasoning: "judge error" };
    }
  }

  private async judgeAgreement(prompt: string, answerA: string, answerB: string): Promise<boolean> {
    if (!answerA || !answerB) return false;
    const input: ModelInput = {
      prompt: `Do these two answers to the same question agree on the core fact? Answer ONLY JSON: {"agree":true} or {"agree":false}.\nQuestion: ${prompt}\nAnswer A: ${answerA.slice(0, 800)}\nAnswer B: ${answerB.slice(0, 800)}`,
      mode: "text"
    };
    try {
      const out = await withTimeout(this.challenger.complete(input), CALL_TIMEOUT_MS, "judge agree");
      const parsed = extractJson(out.text) as { agree?: boolean };
      return Boolean(parsed.agree);
    } catch {
      return false;
    }
  }

  private async generateFinalReport(): Promise<void> {
    this.state.status = "reporting";
    await this.saveState();
    const probes = this.state.probes;
    const score = (s: ProbeScore) => (s.score === "pass" ? 1 : s.score === "partial" ? 0.5 : 0);
    const rate = (arr: ProbeScore[]) => arr.length ? Math.round((arr.reduce((a, b) => a + score(b), 0) / arr.length) * 100) : 0;
    const swRate = rate(probes.map((p) => p.scores.stateweave));
    const naiveRate = rate(probes.map((p) => p.scores.naive));
    const windowedRate = rate(probes.map((p) => p.scores.windowed));
    const drifts = this.state.consistencyChecks.filter((c) => !c.matchesGold);
    const diffBreakdown: InfiniteFinalReport["categoryBreakdown"] = [...new Set(probes.map((p) => p.difficulty))].map((d) => {
      const subset = probes.filter((p) => p.difficulty === d);
      return { difficulty: d, count: subset.length, stateweavePassRate: rate(subset.map((p) => p.scores.stateweave)), naivePassRate: rate(subset.map((p) => p.scores.naive)), windowedPassRate: rate(subset.map((p) => p.scores.windowed)) };
    });

    const input: ModelInput = {
      prompt: `You are the lead interviewer who just completed a ${this.state.turnCount}-turn adversarial interview of a memory system called StateWeave, compared against a naive messages[] baseline and a sliding-window baseline.\n\nResults across ${probes.length} scored recall probes:\n- StateWeave pass rate: ${swRate}%\n- Naive messages[] pass rate: ${naiveRate}%\n- Windowed messages[] pass rate: ${windowedRate}%\n\nConsistency checks: ${this.state.consistencyChecks.length} (${drifts.length} failed to match gold on re-ask).\n\nCategory breakdown:\n${diffBreakdown.map((d) => `- ${d.difficulty}: SW ${d.stateweavePassRate}%, naive ${d.naivePassRate}%, windowed ${d.windowedPassRate}% (${d.count} probes)`).join("\n")}\n\nGraph state: ${this.state.graphSnapshot?.nodeCount ?? 0} nodes, ${this.state.graphSnapshot?.clusterCount ?? 0} clusters.\n\nWrite a direct executive assessment as JSON:\n{"summary":"2-3 sentence verdict","strengths":["..."],"weaknesses":["..."],"verdict":"one punchy line"}\nBe specific and honest. If StateWeave is not clearly better on quality, say so.`,
      mode: "text"
    };
    let report: InfiniteFinalReport = {
      generatedAt: new Date().toISOString(),
      summary: `StateWeave: ${swRate}% pass vs naive ${naiveRate}% vs windowed ${windowedRate}% across ${probes.length} probes.`,
      strengths: [], weaknesses: [],
      categoryBreakdown: diffBreakdown,
      driftInstances: drifts.map((c) => ({ turn: c.reaskTurn, description: `Re-ask of turn ${c.originalTurn} did not match gold: "${c.prompt.slice(0, 80)}"` })),
      verdict: swRate > Math.max(naiveRate, windowedRate) ? "StateWeave retained memory better under load." : "No clear quality advantage; context efficiency without quality is not enough."
    };
    try {
      const out = await withTimeout(this.challenger.complete(input), CALL_TIMEOUT_MS, "final report");
      const parsed = extractJson(out.text) as Partial<InfiniteFinalReport>;
      report = { ...report, ...parsed, categoryBreakdown: diffBreakdown, driftInstances: report.driftInstances, generatedAt: report.generatedAt };
    } catch { /* keep computed fallback */ }
    this.state.finalReport = report;
  }
}

function emptyState(batchSize: number, batchCount: number, selfImprove: boolean, challengerModel: string, agentModel: string): InfiniteState {
  const now = new Date().toISOString();
  return { status: "idle", batchSize, batchCount, turnCount: 0, startedAt: now, updatedAt: now, currentBatch: 0, challengerModel, agentModel, selfImprove, turns: [], series: [], qualitySeries: [], seeds: [], probes: [], consistencyChecks: [], reviews: [] };
}

function graphSnapshot(graph: { nodes: { id: string; type: string; text: string }[]; edges: unknown[] } | undefined, clusters: ReturnType<typeof clusterGraph>): InfiniteState["graphSnapshot"] | undefined {
  if (!graph) return undefined;
  return { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, clusterCount: clusters.length, clusters: clusters.map((c) => ({ id: c.id, label: c.label, nodeCount: c.nodeCount })) };
}

function modelName(model: Model): string {
  const config = (model as unknown as { config?: { model?: string } }).config;
  return config?.model ?? model.constructor.name;
}

function pickDifficulty(turn: number): string {
  const ramp = Math.min(4, Math.floor(turn / 12));
  const labels = ["recall", "recall", "combine", "conflict", "chronology"];
  const pool = labels.slice(0, ramp + 2);
  return pool[Math.floor(Math.random() * pool.length)];
}

function difficultyHint(difficulty: string): string {
  switch (difficulty) {
    case "recall": return "ask for a single planted fact";
    case "combine": return "ask how two facts relate";
    case "conflict": return "present a contradicting decoy and ask for the true fact";
    case "chronology": return "ask which fact came first";
    default: return "test recall of a planted fact";
  }
}

function fallbackSeed(turn: number): SeedRecord {
  const bank: Array<{ prompt: string; facts: string[] }> = [
    { prompt: "Remember: the project codename is HALCYON, the target market is fintech, the launch budget is $4.2M, and the lead engineer is Priya.", facts: ["codename=HALCYON", "market=fintech", "budget=$4.2M", "lead=Priya"] },
    { prompt: "Store: the vault combination is 7-29-44, the access tier is platinum, the expiry is March, and the region is north.", facts: ["combination=7-29-44", "tier=platinum", "expiry=March", "region=north"] },
    { prompt: "Note: the encryption key suffix is B9F2, the rotation policy is quarterly, the custodian is Oren, and the backup site is Vega.", facts: ["suffix=B9F2", "rotation=quarterly", "custodian=Oren", "backup=Vega"] }
  ];
  return { turn, ...bank[turn % bank.length] };
}

export function agentSystemPrompt(): string {
  return [
    "You are a StateWeave agent under adversarial memory testing.",
    "Your StateGraph is persistent working memory that never resets — use it to remember every fact across all turns.",
    "In the same SWX completion, record every new durable fact as a concise semantic node and connect it to the current user_input; connect related facts/entities when useful. For recall-only questions, reuse existing facts instead of duplicating them.",
    "Answer concretely and precisely. When asked to recall a fact, retrieve it from your graph memory and state it directly.",
    "Never guess. If you cannot recall, say so."
  ].join(" ");
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? "";
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}
