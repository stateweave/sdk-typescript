import { expect, it } from "vitest";
import { parseAndValidateOps } from "../src/core/validateOps.js";

it("parses graph ops wrapped in a markdown json fence", () => {
  const ops = parseAndValidateOps(`\n\`\`\`json\n{"ops":[{"op":"final","answer":"done"}]}\n\`\`\`\n`);
  expect(ops).toEqual([{ op: "final", answer: "done" }]);
});

it("parses graph ops with surrounding prose", () => {
  const ops = parseAndValidateOps(`Here is the JSON:\n{"ops":[{"op":"focus","currentFocus":"next"}]}\nThanks.`);
  expect(ops).toEqual([{ op: "focus", currentFocus: "next" }]);
});
