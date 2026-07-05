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

it("accepts model-created semantic node types", () => {
  const ops = parseAndValidateOps(`SWX/1\n@node wisdom_1 wisdom "Graphs preserve non-linear context."\n@node humor_1 humor "The graph is acting like a tiny brain."\n@final "Captured."`);
  expect(ops).toContainEqual({ op: "add_node", node: { id: "wisdom_1", type: "wisdom", text: "Graphs preserve non-linear context." } });
  expect(ops).toContainEqual({ op: "add_node", node: { id: "humor_1", type: "humor", text: "The graph is acting like a tiny brain." } });
});

it("resolves @final node references to node text", () => {
  const ops = parseAndValidateOps(`SWX/1
@node assistant_output_2 [assistant_output]: Tagline: LumaGarden helps teachers cultivate calm learning spaces.
@final assistant_output_2`);
  expect(ops).toContainEqual({
    op: "final",
    answer: "Tagline: LumaGarden helps teachers cultivate calm learning spaces."
  });
});

it("does not mistake equals signs inside quoted labels for attrs", () => {
  const ops = parseAndValidateOps(`SWX/1
@node fact_1 [fact]: "37 × 43 = 1591" status=resolved confidence=1.0
@node assistant_output_3 [assistant_output]: "Last two digits = 49" status=resolved
@final assistant_output_3`);
  expect(ops).toContainEqual({ op: "add_node", node: { id: "fact_1", type: "fact", text: "37 × 43 = 1591", status: "resolved", confidence: 1 } });
  expect(ops).toContainEqual({ op: "final", answer: "Last two digits = 49" });
});

it("parses raw output blocks without requiring artifact as a structural type", () => {
  const ops = parseAndValidateOps(`SWX/1
@node game_1 html_game "Snake SVG" mime=image/svg+xml
@edge user_input_1 creates game_1
@final game_1
<<<game_1:image/svg+xml
<svg viewBox="0 0 10 10">
  <circle cx="5" cy="5" r="4" />
</svg>
>>>`);

  expect(ops).toContainEqual({
    op: "add_node",
    node: {
      id: "game_1",
      type: "html_game",
      text: "Snake SVG",
      status: "resolved",
      data: { mime: "image/svg+xml", content: `<svg viewBox="0 0 10 10">
  <circle cx="5" cy="5" r="4" />
</svg>` }
    }
  });
  expect(ops).toContainEqual({ op: "add_edge", from: "user_input_1", to: "game_1", type: "creates" });
  expect(ops).toContainEqual({
    op: "final",
    answer: `<svg viewBox="0 0 10 10">
  <circle cx="5" cy="5" r="4" />
</svg>`,
    artifactId: "game_1"
  });
});

it("tolerates a final SWX block missing its closing sentinel", () => {
  const ops = parseAndValidateOps(`SWX/1
@node output_3 html_game "Fixed Pac-Man" mime=text/html
@edge user_input_3 creates output_3
@final output_3
<<<output_3:text/html
<html><body>Pac-Man</body></html>`);

  expect(ops).toContainEqual({
    op: "add_node",
    node: {
      id: "output_3",
      type: "html_game",
      text: "Fixed Pac-Man",
      status: "resolved",
      data: { mime: "text/html", content: "<html><body>Pac-Man</body></html>", swxTerminated: false }
    }
  });
  expect(ops).toContainEqual({ op: "final", answer: "<html><body>Pac-Man</body></html>", artifactId: "output_3" });
});

it("parses graph ops wrapped in a markdown swx fence", () => {
  const ops = parseAndValidateOps(`\n\`\`\`swx\nSWX/1\n@focus "next"\n\`\`\`\n`);
  expect(ops).toEqual([{ op: "focus", currentFocus: "next" }]);
});

it("parses node-targeted focus", () => {
  const ops = parseAndValidateOps(`SWX/1
@focus user_input_2 "Work from the fresh user input"
@final "Ready."`);
  expect(ops).toContainEqual({ op: "focus", nodeId: "user_input_2", currentFocus: "Work from the fresh user input" });
});

it("keeps legacy JSON parsing as a compatibility fallback", () => {
  const ops = parseAndValidateOps(`Here is the JSON:\n{"ops":[{"op":"final","answer":"done"}]}\nThanks.`);
  expect(ops).toEqual([{ op: "final", answer: "done" }]);
});

it("explains invalid exchanges", () => {
  expect(() => parseAndValidateOps(`{"ops":[{"op":"final","answer":"unfinished`)).toThrow(/invalid StateWeave exchange/i);
});
