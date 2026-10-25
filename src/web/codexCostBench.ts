// Paired cost bench: the same Codex model and reasoning level drive a StateWeave
// Agent and a traditional transcript agent through one scripted long chat, with
// no tools. Every provider call is metered from Codex's own usage report.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent } from "../agent/agent.js";
import { AgenticBaseline } from "../evals/agenticBaseline.js";
import type { Model, ModelInput, ModelOutput, ModelToken, ModelUsage } from "../llm/model.js";
import type { CodexSelection, CodexUsage } from "../llm/codexModel.js";

export type Pricing = { input: number; cachedInput: number; output: number };
export type ArmName = "stateweave" | "traditional";
export type ArmTotals = { calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; missingUsageCalls: number; costUsd: number; peakInputTokens: number };
export type TurnRecord = {
  turn: number;
  kind: "fact" | "filler" | "check";
  prompt: string;
  arms: Record<ArmName, { status: "done" | "failed"; answer?: string; error?: string; ms: number; usage: ArmTotals; check?: { passed: boolean; missing: string[]; forbidden: string[] } }>;
};
export type BenchState = {
  id: string;
  status: "running" | "done" | "stopped" | "failed";
  model: string;
  reasoningEffort?: string;
  pricing: Pricing;
  turnsPlanned: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  turns: TurnRecord[];
  totals: Record<ArmName, ArmTotals>;
};

export const defaultPricing: Record<string, Pricing> = {
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 }
};

/** Long-context surcharge applied per call above 272K input tokens. */
const longContextThreshold = 272_000;

export function callCost(usage: ModelUsage & { reasoningTokens?: number }, pricing: Pricing): number {
  const cached = usage.cacheReadInputTokens ?? 0;
  const uncached = usage.uncachedInputTokens ?? Math.max(0, usage.inputTokens - cached);
  const long = usage.inputTokens > longContextThreshold;
  const inputMultiplier = long ? 2 : 1;
  const outputMultiplier = long ? 1.5 : 1;
  return ((uncached * pricing.input + cached * pricing.cachedInput) * inputMultiplier + usage.outputTokens * pricing.output * outputMultiplier) / 1_000_000;
}

export function emptyTotals(): ArmTotals {
  return { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, missingUsageCalls: 0, costUsd: 0, peakInputTokens: 0 };
}

export function addUsage(totals: ArmTotals, usage: (ModelUsage & { reasoningTokens?: number }) | undefined, pricing: Pricing): void {
  totals.calls += 1;
  if (!usage) {
    totals.missingUsageCalls += 1;
    return;
  }
  totals.inputTokens += usage.inputTokens;
  totals.cachedInputTokens += usage.cacheReadInputTokens ?? 0;
  totals.outputTokens += usage.outputTokens;
  totals.reasoningTokens += usage.reasoningTokens ?? 0;
  totals.peakInputTokens = Math.max(totals.peakInputTokens, usage.inputTokens);
  totals.costUsd += callCost(usage, pricing);
}

function mergeTotals(into: ArmTotals, from: ArmTotals): void {
  into.calls += from.calls;
  into.inputTokens += from.inputTokens;
  into.cachedInputTokens += from.cachedInputTokens;
  into.outputTokens += from.outputTokens;
  into.reasoningTokens += from.reasoningTokens;
  into.missingUsageCalls += from.missingUsageCalls;
  into.costUsd += from.costUsd;
  into.peakInputTokens = Math.max(into.peakInputTokens, from.peakInputTokens);
}

/** Wraps a model and meters every call made through it into the active turn bucket. */
export class MeteredModel implements Model {
  bucket: ArmTotals = emptyTotals();
  constructor(private readonly inner: Model, private readonly pricing: Pricing) {}

  async complete(input: ModelInput): Promise<ModelOutput> {
    const output = await this.inner.complete(input);
    addUsage(this.bucket, output.usage as CodexUsage | undefined, this.pricing);
    return output;
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    let usage: CodexUsage | undefined;
    for await (const event of this.inner.stream(input)) {
      if (event.type === "metadata" && event.metadata.usage) usage = event.metadata.usage as CodexUsage;
      yield event;
    }
    addUsage(this.bucket, usage, this.pricing);
  }
}

type ScriptTurn = { kind: TurnRecord["kind"]; prompt: string; expect?: string[]; forbid?: string[] };

/** Project Halcyon: facts are planted, later corrected, buried under long filler, then probed. */
export const halcyonScript: ScriptTurn[] = [
  { kind: "fact", prompt: "We're planning Project Halcyon, a community solar co-op in Tromsø, Norway. Key facts: budget NOK 4.2 million, public launch 14 March 2027, lead engineer Ingrid Solberg. 38 households have signed letters of intent. Acknowledge and summarise the plan in 3 bullets." },
  { kind: "filler", prompt: "Write a detailed project outline for Halcyon (about 700 words): phases, milestones, stakeholders, and the permitting path with Tromsø kommune and NVE. Note the polar-night production gap and how winter demand is covered." },
  { kind: "fact", prompt: "Update: the board cut the budget to NOK 3.8 million, and the launch moves to 2 May 2027 because of snow-load certification. Ingrid is leaving; Mateo Ruiz is now lead engineer. Confirm the new facts briefly." },
  { kind: "filler", prompt: "Draft about 700 words explaining Norwegian plusskunde (prosumer) net-metering rules and how a co-op could share production among members. Use plain language for households." },
  { kind: "check", prompt: "Quick check without re-explaining: what is Halcyon's current budget, launch date, and lead engineer?", expect: ["3.8", "2 May", "Mateo"], forbid: ["4.2", "14 March", "Ingrid is the lead", "lead engineer Ingrid"] },
  { kind: "filler", prompt: "Produce a risk register table for Halcyon with at least 12 risks: columns Risk, Likelihood, Impact, Mitigation, Owner. Include snow load, arctic light, supplier delays, member churn and grid connection." },
  { kind: "filler", prompt: "Write a member-facing FAQ of about 15 questions and answers (roughly 800 words) covering costs, savings, winter months, maintenance and leaving the co-op." },
  { kind: "filler", prompt: "Draft a 600-word press release announcing Halcyon to local media. Use placeholders rather than restating budget numbers." },
  { kind: "check", prompt: "Before we send anything: who is the lead engineer now, and who was it originally? One line each.", expect: ["Mateo", "Ingrid"], forbid: [] },
  { kind: "check", prompt: "Final sanity check. Give, in one sentence each: the current budget, the launch date, how many households signed letters of intent, and why the launch moved.", expect: ["3.8", "2 May", "38", "snow"], forbid: ["4.2 million is the current", "14 March 2027 launch"] }
];

export function scoreCheck(answer: string, turn: ScriptTurn): { passed: boolean; missing: string[]; forbidden: string[] } {
  const lower = answer.toLowerCase();
  const missing = (turn.expect ?? []).filter((value) => !lower.includes(value.toLowerCase()));
  const forbidden = (turn.forbid ?? []).filter((value) => lower.includes(value.toLowerCase()));
  return { passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

const benchSystemPrompt = "You are a careful project assistant for a long-running planning conversation. Track facts precisely; when facts are updated, use the newest values. No tools are available.";

export class CodexCostBench {
  state?: BenchState;
  private controller?: AbortController;

  constructor(private readonly reportDir: string) {}

  get running(): boolean {
    return this.state?.status === "running";
  }

  start(args: { createModel: (arm: "stateweave" | "traditional") => Model; selection: CodexSelection; pricing: Pricing; turns: number }): BenchState {
    if (this.running) throw new Error("A bench run is already in progress.");
    const turns = Math.max(1, Math.min(halcyonScript.length, Math.floor(args.turns)));
    this.controller = new AbortController();
    this.state = {
      id: `cb_${randomUUID().replace(/-/g, "")}`,
      status: "running",
      model: args.selection.model,
      ...(args.selection.reasoningEffort ? { reasoningEffort: args.selection.reasoningEffort } : {}),
      pricing: args.pricing,
      turnsPlanned: turns,
      startedAt: new Date().toISOString(),
      turns: [],
      totals: { stateweave: emptyTotals(), traditional: emptyTotals() }
    };
    void this.execute(this.state, args, turns, this.controller.signal);
    return this.state;
  }

  stop(): void {
    if (!this.running) return;
    this.controller?.abort();
  }

  private async execute(state: BenchState, args: { createModel: (arm: "stateweave" | "traditional") => Model; pricing: Pricing }, turns: number, signal: AbortSignal): Promise<void> {
    const stateModel = new MeteredModel(args.createModel("stateweave"), args.pricing);
    const traditionalModel = new MeteredModel(args.createModel("traditional"), args.pricing);
    const stateAgent = new Agent({ model: stateModel, tools: [], maxIterations: 6, maxPromptTokens: 64_000, projectionTargetTokens: 16_000, projectionMaxNodes: 16, contextMode: "molecular", systemPrompt: benchSystemPrompt });
    const traditionalAgent = new AgenticBaseline({
      model: traditionalModel,
      tools: [],
      systemPrompt: benchSystemPrompt,
      maxIterations: 6,
      maxContextTokens: 64_000,
      compaction: { thresholdTokens: 30_000, retainMessages: 6, durablePreflight: true, validateSummary: true },
      transcriptOnly: true,
      captureProviderFailures: true
    });
    try {
      for (let index = 0; index < turns; index++) {
        if (signal.aborted) break;
        const script = halcyonScript[index]!;
        stateModel.bucket = emptyTotals();
        traditionalModel.bucket = emptyTotals();
        const timed = async (arm: ArmName, run: () => Promise<{ ok: boolean; answer: string; error?: string }>) => {
          const started = Date.now();
          try {
            const result = await run();
            return { arm, ms: Date.now() - started, ...result };
          } catch (error) {
            return { arm, ms: Date.now() - started, ok: false, answer: "", error: error instanceof Error ? error.message : String(error) };
          }
        };
        const [sw, tr] = await Promise.all([
          timed("stateweave", async () => {
            const result = await stateAgent.run(script.prompt, { signal });
            return { ok: true, answer: result.finalAnswer };
          }),
          timed("traditional", async () => {
            const result = await traditionalAgent.run(script.prompt, { signal });
            return { ok: result.completed, answer: result.answer, ...(result.completed ? {} : { error: result.error ?? "Traditional agent did not complete." }) };
          })
        ]);
        const record: TurnRecord = { turn: index + 1, kind: script.kind, prompt: script.prompt, arms: {} as TurnRecord["arms"] };
        for (const [run, bucket] of [[sw, stateModel.bucket], [tr, traditionalModel.bucket]] as const) {
          mergeTotals(state.totals[run.arm], bucket);
          record.arms[run.arm] = {
            status: run.ok ? "done" : "failed",
            ...(run.ok ? { answer: run.answer.slice(0, 20_000) } : { error: run.error }),
            ms: run.ms,
            usage: { ...bucket },
            ...(script.kind === "check" && run.ok ? { check: scoreCheck(run.answer, script) } : {})
          };
        }
        state.turns.push(record);
        if (!sw.ok && !tr.ok) throw new Error("Both arms failed this turn; the run stopped to avoid spending more.");
      }
      state.status = signal.aborted ? "stopped" : "done";
    } catch (error) {
      state.status = signal.aborted ? "stopped" : "failed";
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.finishedAt = new Date().toISOString();
      await this.persist(state).catch(() => undefined);
    }
  }

  private async persist(state: BenchState): Promise<void> {
    await mkdir(this.reportDir, { recursive: true });
    await writeFile(path.join(this.reportDir, `${state.id}.json`), JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}
