import path from "node:path";
import { expect, it } from "vitest";
import { buildChallengerProtocolManifest, CHALLENGER_V6_CORPUS_SHA256, CHALLENGER_V6_PROTOCOL_ID } from "../src/evals/challengerProtocol.js";

it("freezes a balanced Challenger v6 calibration and held-out protocol", async () => {
  const manifest = await buildChallengerProtocolManifest(path.resolve(process.cwd(), "data/challenger-scenarios"));

  expect(manifest.protocolId).toBe(CHALLENGER_V6_PROTOCOL_ID);
  expect(manifest.corpusSha256).toBe(CHALLENGER_V6_CORPUS_SHA256);
  expect(manifest.calibration).toHaveLength(16);
  expect(manifest.heldOut).toHaveLength(8);
  expect(manifest.calibrationTurns).toBe(120);
  expect(manifest.heldOutTurnsPerTrajectory).toBe(60);
  expect(manifest.scoredPairedTurns).toBe(180);
  expect(manifest.evaluationOrders).toHaveLength(3);
  expect(new Set(manifest.evaluationOrders.map((order) => order.join("/"))).size).toBe(3);
  for (const order of manifest.evaluationOrders) {
    expect(new Set(order)).toEqual(new Set(manifest.heldOut.map((scenario) => scenario.id)));
  }
});
