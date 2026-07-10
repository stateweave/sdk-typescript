import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GraphMemoryAgent } from "./graphMemoryAgent.js";
import { agentSystemPrompt, type InfiniteReplayTurn, type ProbeScore } from "./infiniteHarness.js";
import type { Model, ModelInput } from "../llm/model.js";

const CALL_TIMEOUT_MS = 90_000;

export type ReplayCategory = {
  difficulty: string;
  baselineScore: number;
  candidateScore: number;
  count: number;
};

export type InfiniteReplayState = {
  status: "running" | "done" | "failed";
  turnCount: number;
  totalTurns: number;
  scoredProbes: number;
  baselineScore: number;
  candidateScore: number;
  averagePromptTokens: number;
  validTransactions: number;
  invalidTransactions: number;
  categories: ReplayCategory[];
  failures: Array<{ turn: number; difficulty: string; prompt: string; reasoning: string }>;
  startedAt: string;
  updatedAt: string;
  message?: string;
};

export async function runInfiniteReplay(args: {
  replayPath: string;
  statePath: string;
  model: Model;
  judgeModel: Model;
  onProgress?: (state: InfiniteReplayState) => void;
}): Promise<InfiniteReplayState> {
  const plan = await readReplayPlan(args.replayPath);
  const agent = new GraphMemoryAgent({ model: args.model, systemPrompt: agentSystemPrompt() });
  const startedAt = new Date().toISOString();
  const baselineScores: ProbeScore[] = [];
  const candidateScores: ProbeScore[] = [];
  const categories = new Map<string, { baseline: ProbeScore[]; candidate: ProbeScore[] }>();
  const tokenEstimates: number[] = [];
  const failures: InfiniteReplayState["failures"] = [];
  let validTransactions = 0;
  let invalidTransactions = 0;
  let state = snapshot("running", 0);

  function snapshot(status: InfiniteReplayState["status"], turnCount: number, message?: string): InfiniteReplayState {
    return {
      status,
      turnCount,
      totalTurns: plan.length,
      scoredProbes: candidateScores.length,
      baselineScore: rate(baselineScores),
      candidateScore: rate(candidateScores),
      averagePromptTokens: tokenEstimates.length ? Math.round(tokenEstimates.reduce((sum, value) => sum + value, 0) / tokenEstimates.length) : 0,
      validTransactions,
      invalidTransactions,
      categories: [...categories.entries()].map(([difficulty, scores]) => ({
        difficulty,
        baselineScore: rate(scores.baseline),
        candidateScore: rate(scores.candidate),
        count: scores.candidate.length
      })),
      failures: failures.slice(-12),
      startedAt,
      updatedAt: new Date().toISOString(),
      ...(message ? { message } : {})
    };
  }

  try {
    await mkdir(path.dirname(args.statePath), { recursive: true });
    for (let index = 0; index < plan.length; index++) {
      const turn = plan[index];
      const result = await withTimeout(agent.run(turn.prompt), CALL_TIMEOUT_MS, `candidate turn ${turn.turn}`);
      tokenEstimates.push(result.tokenEstimate);
      if (result.transactionValid) validTransactions += 1;
      else invalidTransactions += 1;

      if (turn.probe) {
        const candidate = await judgeScore(args.judgeModel, turn.prompt, turn.probe.assertions, turn.probe.goldAnswer, result.answer);
        baselineScores.push(turn.probe.baselineScore);
        candidateScores.push(candidate);
        const bucket = categories.get(turn.probe.difficulty) ?? { baseline: [], candidate: [] };
        bucket.baseline.push(turn.probe.baselineScore);
        bucket.candidate.push(candidate);
        categories.set(turn.probe.difficulty, bucket);
        if (candidate.score !== "pass") {
          failures.push({ turn: turn.turn, difficulty: turn.probe.difficulty, prompt: turn.prompt.slice(0, 180), reasoning: candidate.reasoning });
        }
      }

      state = snapshot("running", index + 1);
      await writeFile(args.statePath, JSON.stringify(state, null, 2));
      args.onProgress?.(structuredClone(state));
    }
    state = snapshot("done", plan.length);
  } catch (error) {
    state = snapshot("failed", state.turnCount, error instanceof Error ? error.message : String(error));
  }

  await writeFile(args.statePath, JSON.stringify(state, null, 2));
  return state;
}

async function readReplayPlan(replayPath: string): Promise<InfiniteReplayTurn[]> {
  const raw = await readFile(replayPath, "utf8");
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as InfiniteReplayTurn);
}

async function judgeScore(model: Model, prompt: string, assertions: string[], gold: string, answer: string): Promise<ProbeScore> {
  const input: ModelInput = {
    prompt: `You are a strict grader. Score the agent's answer.\nQuestion: ${prompt}\nKey assertions the answer must include: ${JSON.stringify(assertions)}\nGold reference: ${gold}\nAgent answer: ${answer.slice(0, 1500)}\nOutput ONLY JSON: {"score":"pass"|"partial"|"fail","reasoning":"one short sentence"}\nRules: pass = answer contains the essential correct fact(s). partial = vague or missing detail. fail = wrong, evasive, or hallucinated.`,
    mode: "text"
  };
  try {
    const out = await withTimeout(model.complete(input), CALL_TIMEOUT_MS, "candidate judge");
    const parsed = extractJson(out.text) as { score?: string; reasoning?: string };
    const score = parsed.score === "pass" ? "pass" : parsed.score === "partial" ? "partial" : "fail";
    return { score, reasoning: String(parsed.reasoning ?? score).slice(0, 200) };
  } catch {
    return { score: "fail", reasoning: "judge error" };
  }
}

function rate(scores: ProbeScore[]): number {
  if (!scores.length) return 0;
  const total = scores.reduce((sum, score) => sum + (score.score === "pass" ? 1 : score.score === "partial" ? 0.5 : 0), 0);
  return Math.round((total / scores.length) * 1000) / 10;
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
