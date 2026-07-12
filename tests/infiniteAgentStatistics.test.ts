import { describe, expect, it } from "vitest";
import { analyzeBlocks, type InfiniteAgentBlock } from "../src/evals/infiniteAgentHarness.js";

function block(block: number, difference: number): InfiniteAgentBlock {
  const nativeQuality = 0.5;
  return { block, turns: 8, nativeQuality, stateweaveQuality: nativeQuality + difference, difference };
}

describe("Infinite Agent preregistered analysis", () => {
  it("is deterministic for the frozen seed", () => {
    const blocks = [block(1, 0.2), block(2, 0.1), block(3, -0.05), block(4, 0.15)];
    expect(analyzeBlocks(blocks, 20260711)).toEqual(analyzeBlocks(blocks, 20260711));
  });

  it("uses complete component blocks as the analysis unit", () => {
    const evidence = analyzeBlocks([block(1, 0.25), block(2, 0.25), block(3, 0.25)], 7);
    expect(evidence).toMatchObject({
      unit: "eight-turn full-stack release block",
      blocks: 3,
      meanDifference: 0.25,
      wins: 3,
      ties: 0,
      losses: 0,
      signTestPValue: 0.25
    });
    expect(evidence!.confidenceLow).toBeCloseTo(0.25);
    expect(evidence!.confidenceHigh).toBeCloseTo(0.25);
  });

  it("does not report evidence before two independent blocks", () => {
    expect(analyzeBlocks([], 1)).toBeUndefined();
    expect(analyzeBlocks([block(1, 0.1)], 1)).toBeUndefined();
  });
});
