import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listChallengerScenarios, readChallengerScenario, type ChallengerScenario } from "./challengerScenarioLibrary.js";

export const CHALLENGER_V6_PROTOCOL_ID = "infinite-v6-challenger-heldout-r5-20260714";
export const CHALLENGER_V6_SEED = 20260714;
export const CHALLENGER_V6_CORPUS_SHA256 = "4e5eaec89a10c2dccbfe20698215d8ee1722d8696e28358b348449ccc7c935bd";
export const CHALLENGER_V6_REPETITIONS = 3;
export const CHALLENGER_V6_EVALUATION_ORDERS = [
  ["community-program-015", "permissions-redesign-005", "crisis-communications-017", "vendor-risk-020", "experiment-analysis-011", "acquisition-diligence-007", "personal-knowledge-system-024", "security-breach-008"],
  ["security-breach-008", "crisis-communications-017", "vendor-risk-020", "experiment-analysis-011", "acquisition-diligence-007", "permissions-redesign-005", "community-program-015", "personal-knowledge-system-024"],
  ["personal-knowledge-system-024", "experiment-analysis-011", "security-breach-008", "acquisition-diligence-007", "permissions-redesign-005", "crisis-communications-017", "vendor-risk-020", "community-program-015"]
] as const;

export type ChallengerProtocolManifest = {
  protocolId: string;
  seed: number;
  corpusSha256: string;
  calibration: Array<{ id: string; filename: string; turns: number; sha256: string }>;
  heldOut: Array<{ id: string; filename: string; turns: number; sha256: string }>;
  evaluationOrders: string[][];
  calibrationTurns: number;
  heldOutTurnsPerTrajectory: number;
  scoredPairedTurns: number;
};

export async function buildChallengerProtocolManifest(rootDir: string): Promise<ChallengerProtocolManifest> {
  const summaries = await listChallengerScenarios(rootDir);
  const scenarios = await Promise.all(summaries.map(async (summary) => {
    const scenario = await readChallengerScenario(rootDir, summary.filename);
    if (!scenario) throw new Error(`Missing Challenger scenario ${summary.filename}.`);
    return scenario;
  }));
  const corpusSha256 = await corpusDigest(rootDir, scenarios);
  if (corpusSha256 !== CHALLENGER_V6_CORPUS_SHA256) {
    throw new Error(`Challenger v6 corpus hash mismatch: expected ${CHALLENGER_V6_CORPUS_SHA256}, received ${corpusSha256}. Bump and refreeze the protocol instead of silently changing it.`);
  }
  const calibration = scenarios.filter((scenario) => scenario.status === "calibration").map(manifestScenario);
  const heldOut = scenarios.filter((scenario) => scenario.status === "held-out").map(manifestScenario);
  if (calibration.length !== 16 || heldOut.length !== 8) throw new Error("Challenger v6 requires exactly 16 calibration and 8 held-out scenarios.");
  const heldOutIds = new Set(heldOut.map((scenario) => scenario.id));
  const evaluationOrders = CHALLENGER_V6_EVALUATION_ORDERS.map((order) => [...order]);
  if (new Set(evaluationOrders.map((order) => order.join("\0"))).size !== CHALLENGER_V6_REPETITIONS) throw new Error("Challenger v6 evaluation orders must be distinct.");
  for (const order of evaluationOrders) {
    if (order.length !== heldOutIds.size || order.some((id) => !heldOutIds.has(id))) throw new Error("Challenger v6 frozen evaluation order does not match the held-out split.");
  }
  const calibrationTurns = calibration.reduce((sum, scenario) => sum + scenario.turns, 0);
  const heldOutTurnsPerTrajectory = heldOut.reduce((sum, scenario) => sum + scenario.turns, 0);
  return {
    protocolId: CHALLENGER_V6_PROTOCOL_ID,
    seed: CHALLENGER_V6_SEED,
    corpusSha256,
    calibration,
    heldOut,
    evaluationOrders,
    calibrationTurns,
    heldOutTurnsPerTrajectory,
    scoredPairedTurns: heldOutTurnsPerTrajectory * CHALLENGER_V6_REPETITIONS
  };
}

function manifestScenario(scenario: ChallengerScenario): { id: string; filename: string; turns: number; sha256: string } {
  return { id: scenario.id, filename: scenario.filename, turns: scenario.estimatedTurns, sha256: createHash("sha256").update(scenario.markdown).digest("hex") };
}

async function corpusDigest(rootDir: string, scenarios: ChallengerScenario[]): Promise<string> {
  const digest = createHash("sha256");
  for (const scenario of [...scenarios].sort((left, right) => left.filename.localeCompare(right.filename))) {
    digest.update(scenario.filename).update("\0").update(await readFile(path.join(rootDir, scenario.filename))).update("\0");
  }
  return digest.digest("hex");
}

