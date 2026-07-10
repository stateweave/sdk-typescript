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
  expect(ops).toContainEqual({ op: "final", answer: "Completed. See game_1.", artifactId: "game_1", artifactIds: ["game_1"] });
});

it("parses graph worker scheduler ops", () => {
  const ops = parseAndValidateOps(`SWX/1
@edge system_root follows user_input_1
@worker ui objective="Build the UI shell" focus=user_input_1 input="Use HTML" maxIterations=3
@worker logic "Build game logic" focus=user_input_1`);

  expect(ops).toContainEqual({ op: "spawn_worker", id: "ui", objective: "Build the UI shell", focusNodeId: "user_input_1", input: "Use HTML", maxIterations: 3 });
  expect(ops).toContainEqual({ op: "spawn_worker", id: "logic", objective: "Build game logic", focusNodeId: "user_input_1" });
});

it("parses @zoom navigation ops", () => {
  const ops = parseAndValidateOps(`SWX/1
@zoom 3`);
  expect(ops).toContainEqual({ op: "zoom", level: 3 });
});

it("parses multiline @tool args through block refs without creating artifact ops", () => {
  const ops = parseAndValidateOps(`SWX/1
@edge system_root follows user_input_1
@tool edit_file file_path=README.md old_string_ref=old_1 new_string_ref=new_1 replace_all=true
<<<old_1:text/plain
old line
with detail
>>>
<<<new_1:text/plain
new line
with detail
>>>`);

  expect(ops).toEqual([
    { op: "add_edge", from: "system_root", to: "user_input_1", type: "follows" },
    {
      op: "call_tool",
      tool: "edit_file",
      args: {
        file_path: "README.md",
        old_string: "old line\nwith detail",
        new_string: "new line\nwith detail",
        replace_all: true
      }
    }
  ]);
});

it("preserves unquoted multi-token tool values until the next named argument", () => {
  const ops = parseAndValidateOps(`SWX/1
@tool edit_file file_path=config.js old_string=retryLimit: RETRY_LIMIT + 1 new_string=retryLimit: RETRY_LIMIT
@tool bash_command command=node --check config.js timeout_ms=1000`);
  expect(ops).toEqual([
    { op: "call_tool", tool: "edit_file", args: { file_path: "config.js", old_string: "retryLimit: RETRY_LIMIT + 1", new_string: "retryLimit: RETRY_LIMIT" } },
    { op: "call_tool", tool: "bash_command", args: { command: "node --check config.js", timeout_ms: 1000 } }
  ]);
});

it("parses long final answer blocks with optional multiple artifact refs", () => {
  const ops = parseAndValidateOps(`SWX/1
@node game_1 artifact "Snake" mime=text/html
@node game_2 artifact "Tetris" mime=text/html
@edge user_input_1 creates game_1
@edge user_input_1 creates game_2
@final_ref final_answer artifacts=game_1,game_2
<<<final_answer:text/markdown
Created two games:
- Snake
- Tetris
>>>
<<<game_1:text/html
<html>Snake</html>
>>>
<<<game_2:text/html
<html>Tetris</html>
>>>`);

  expect(ops).toContainEqual({
    op: "final",
    answer: "Created two games:\n- Snake\n- Tetris",
    artifactId: "game_1",
    artifactIds: ["game_1", "game_2"]
  });
  expect(ops).not.toContainEqual(expect.objectContaining({ op: "add_node", node: expect.objectContaining({ id: "final_answer" }) }));
});

it("parses long final answer blocks without artifacts", () => {
  const ops = parseAndValidateOps(`SWX/1
@edge system_root follows user_input_1
@final_ref final_answer
<<<final_answer:text/markdown
Here is a longer answer.

It has multiple paragraphs.
>>>`);

  expect(ops).toContainEqual({ op: "final", answer: "Here is a longer answer.\n\nIt has multiple paragraphs." });
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
  expect(ops).toContainEqual({ op: "final", answer: "Completed. See output_3.", artifactId: "output_3", artifactIds: ["output_3"] });
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

it("parses slug node-targeted focus", () => {
  const ops = parseAndValidateOps(`SWX/1
@focus index_page "All files complete"
@final "Ready."`);
  expect(ops).toContainEqual({ op: "focus", nodeId: "index_page", currentFocus: "All files complete" });
});

it("keeps legacy JSON parsing as a compatibility fallback", () => {
  const ops = parseAndValidateOps(`Here is the JSON:\n{"ops":[{"op":"final","answer":"done"}]}\nThanks.`);
  expect(ops).toEqual([{ op: "final", answer: "done" }]);
});

it("explains invalid exchanges", () => {
  expect(() => parseAndValidateOps(`{"ops":[{"op":"final","answer":"unfinished`)).toThrow(/invalid StateWeave exchange/i);
});
