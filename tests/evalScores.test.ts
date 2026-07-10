import { expect, it } from "vitest";
import { scoreEvalRecords } from "../web/src/evalScores.js";
import { qualityValue } from "../src/evals/infiniteAgentHarness.js";

it("scores infinite-agent partial results by checks passed rather than a flat half point", () => {
  expect(qualityValue({ score: "partial", passed: 1, total: 5, details: [] })).toBe(0.2);
  expect(qualityValue({ score: "partial", passed: 3, total: 4, details: [] })).toBe(0.75);
});

it("scores live eval records by hidden A/B mapping", () => {
  expect(scoreEvalRecords([
    { a: "stateweave", b: "regular", vote: "a" },
    { a: "regular", b: "stateweave", vote: "a" },
    { a: "regular", b: "stateweave", vote: "b" },
    { a: "stateweave", b: "regular", vote: "both" },
    { a: "regular", b: "stateweave", vote: "neither" },
    { a: "stateweave", b: "regular" }
  ])).toEqual({
    stateweave: 2,
    regular: 1,
    both: 1,
    neither: 1,
    completed: 5
  });
});
