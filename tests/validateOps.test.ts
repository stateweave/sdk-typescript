import { expect, it } from "vitest";
import { parseAndValidateOps } from "../src/core/validateOps.js";

it("parses compact SWX graph operations", () => {
  const ops = parseAndValidateOps(`SWX/1
@node fact_user_name fact "The user's name is Radi." confidence=1 status=active
@edge user_input_1 supports fact_user_name
@final "Nice to meet you, Radi."`);
  expect(ops).toEqual([
    { op: "add_node", node: { id: "fact_user_name", type: "fact", text: "The user's name is Radi.", confidence: 1, status: "active" } },
    { op: "add_edge", from: "user_input_1", to: "fact_user_name", type: "supports" },
    { op: "final", answer: "Nice to meet you, Radi." }
  ]);
});

it("tolerates bracketed node type labels", () => {
  const ops = parseAndValidateOps(`SWX/1\n@node fact_1 [fact]: "User's name is Radi" status=active confidence=1.0\n@final "ok"`);
  expect(ops[0]).toEqual({ op: "add_node", node: { id: "fact_1", type: "fact", text: "User's name is Radi", status: "active", confidence: 1 } });
});

it("parses raw artifact blocks without JSON escaping", () => {
  const ops = parseAndValidateOps(`SWX/1
@node artifact_1 artifact "Snake SVG" mime=image/svg+xml
@edge user_input_1 creates artifact_1
@final artifact_1
<<<artifact_1:image/svg+xml
<svg viewBox="0 0 10 10">
  <circle cx="5" cy="5" r="4" />
</svg>
>>>`);

  expect(ops).toContainEqual({
    op: "add_node",
    node: {
      id: "artifact_1",
      type: "artifact",
      text: "Snake SVG",
      status: "resolved",
      data: { mime: "image/svg+xml", content: `<svg viewBox="0 0 10 10">
  <circle cx="5" cy="5" r="4" />
</svg>` }
    }
  });
  expect(ops).toContainEqual({ op: "add_edge", from: "user_input_1", to: "artifact_1", type: "creates" });
  expect(ops).toContainEqual({
    op: "final",
    answer: `<svg viewBox="0 0 10 10">
  <circle cx="5" cy="5" r="4" />
</svg>`,
    artifactId: "artifact_1"
  });
});

it("parses graph ops wrapped in a markdown swx fence", () => {
  const ops = parseAndValidateOps(`\n\`\`\`swx\nSWX/1\n@focus "next"\n\`\`\`\n`);
  expect(ops).toEqual([{ op: "focus", currentFocus: "next" }]);
});

it("keeps legacy JSON parsing as a compatibility fallback", () => {
  const ops = parseAndValidateOps(`Here is the JSON:\n{"ops":[{"op":"final","answer":"done"}]}\nThanks.`);
  expect(ops).toEqual([{ op: "final", answer: "done" }]);
});

it("explains invalid exchanges", () => {
  expect(() => parseAndValidateOps(`{"ops":[{"op":"final","answer":"unfinished`)).toThrow(/invalid StateWeave exchange/i);
});
