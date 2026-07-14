import path from "node:path";
import { expect, it } from "vitest";
import { generateParticipantStartingMaterials, judgeChallengerPair } from "../src/evals/challengerDirector.js";
import { readChallengerScenario } from "../src/evals/challengerScenarioLibrary.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";

class QueueModel implements Model {
  constructor(private readonly outputs: string[]) {}
  async complete(_input: ModelInput): Promise<ModelOutput> {
    const text = this.outputs.shift();
    if (!text) throw new Error("No queued model output.");
    return { text, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  }
  async *stream(_input: ModelInput): AsyncIterable<ModelToken> { yield { type: "token", token: "" }; }
}

it("generates leak-checked participant starting materials", async () => {
  const scenario = await readChallengerScenario(path.resolve(process.cwd(), "data/challenger-scenarios"), "12-fraud-monitoring.md");
  expect(scenario).toBeDefined();
  const markdown = `# Synthetic fraud operations evidence\n\nThis fictional packet contains a dated alert-volume table, delayed chargeback labels, reviewer staffing notes, and segment-level false-positive observations. Values are intentionally incomplete and should be treated as supplied evidence rather than external facts.\n\n${"Evidence row. ".repeat(30)}`;
  const generated = await generateParticipantStartingMaterials(scenario!, new QueueModel([markdown, JSON.stringify({ safe: true, reason: "No private leakage." })]));
  expect(generated.markdown).toContain("Synthetic fraud operations evidence");
  expect(generated.usage).toEqual({ inputTokens: 20, outputTokens: 10, calls: 2 });
});

it("double-judges in opposite anonymous orders and computes rubric-weighted scores", async () => {
  const scenario = await readChallengerScenario(path.resolve(process.cwd(), "data/challenger-scenarios"), "12-fraud-monitoring.md");
  expect(scenario).toBeDefined();
  const candidate = (score: number) => ({
    score,
    dimensions: scenario!.rubric.map((dimension) => ({ label: dimension.label, score, evidence: "Observable artifact evidence." })),
    acceptance: scenario!.hiddenAcceptanceCriteria.map((criterion) => ({ criterion, met: score > 50, evidence: "Checked." })),
    summary: "Evidence-based judgment."
  });
  const output = JSON.stringify({ candidateA: candidate(80), candidateB: candidate(60) });
  const judgment = await judgeChallengerPair({
    scenario: scenario!,
    turn: scenario!.turns[0]!,
    stateweaveAnswer: "Done",
    transcriptAnswer: "Done",
    stateweaveEvidence: "artifact",
    transcriptEvidence: "artifact",
    model: new QueueModel([output, output]),
    seed: 42
  });

  expect([judgment.stateweave.score, judgment.transcript.score].sort()).toEqual([70, 70]);
  expect(judgment.agreement.requiresHumanReview).toBe(true);
  expect(judgment.usage.calls).toBe(2);
});
