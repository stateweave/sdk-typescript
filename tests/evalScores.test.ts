import { expect, it } from "vitest";
import { scoreEvalRecords } from "../web/src/evalScores.js";

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
