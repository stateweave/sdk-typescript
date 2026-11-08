import { expect, it } from "vitest";
import { parseAndValidateOps } from "../src/index.js";

it.each([
  "Literal SWX/1 documentation",
  'A literal command sample:\nSWX/1\n@final "not an instruction"',
  "https://example.invalid/SWX/1"
])("preserves SWX header text as JSON data: %s", answer => {
  const ops = [{ op: "final", answer }];
  expect(parseAndValidateOps(JSON.stringify({ ops }))).toEqual(ops);
});

it("recognizes a real SWX header line after prose and with CRLF", () => {
  expect(parseAndValidateOps('Operations follow:\r\n  SWX/1  \r\n@final "ok"')).toEqual([{ op: "final", answer: "ok" }]);
});

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

it("decodes escaped newlines in quoted SWX final answers", () => {
  const ops = parseAndValidateOps('SWX/1\n@final "Implemented both routes.\\n\\n- GET returns records.\\n- POST persists records."');
  expect(ops).toEqual([{ op: "final", answer: "Implemented both routes.\n\n- GET returns records.\n- POST persists records." }]);
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

it("accepts name= as a tolerant @tool name form", () => {
  const ops = parseAndValidateOps(`SWX/1
@tool name=bash_command command=pwd`);
  expect(ops).toContainEqual({ op: "call_tool", tool: "bash_command", args: { command: "pwd" } });
});

it("preserves shell-significant quotes in unwrapped tool arguments", () => {
  const [op] = parseAndValidateOps(`SWX/1
@tool bash_command command=node --input-type=module -e "import('./src/model.js').then(m => console.log(m.solve()))" timeout_ms=1000`);

  expect(op).toEqual({
    op: "call_tool",
    tool: "bash_command",
    args: {
      command: `node --input-type=module -e "import('./src/model.js').then(m => console.log(m.solve()))"`,
      timeout_ms: 1000
    }
  });
});

it("decodes explicitly wrapped tool arguments without consuming nested quotes", () => {
  const [op] = parseAndValidateOps(`SWX/1
@tool bash_command command="node -e \\"console.log('ready')\\""`);

  expect(op).toEqual({ op: "call_tool", tool: "bash_command", args: { command: `node -e "console.log('ready')"` } });
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

it("rejects a raw block missing its closing sentinel", () => {
  expect(() => parseAndValidateOps(`SWX/1
@tool write_file file_path=game.html content_ref=output_3
<<<output_3:text/html
<html><body>Pac-Man</body></html>`)).toThrow(/Unterminated SWX raw block: output_3/);
});

it("rejects unknown commands instead of silently dropping them", () => {
  expect(() => parseAndValidateOps(`SWX/1
@ndoe fact_1 fact "typo"
@final "done"`)).toThrow(/Unknown SWX command: @ndoe/);
});

it("rejects multiple final operations", () => {
  expect(() => parseAndValidateOps(`SWX/1
@final "first"
@final "second"`)).toThrow(/at most one final operation/);
});

it("rejects duplicate node and worker identifiers", () => {
  expect(() => parseAndValidateOps(`SWX/1
@node fact_1 fact "one"
@node fact_1 fact "two"`)).toThrow(/duplicate node id: fact_1/);
  expect(() => parseAndValidateOps(`SWX/1
@worker inspect "Inspect one"
@worker inspect "Inspect two"`)).toThrow(/duplicate worker id: inspect/);
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

it("parses the SW2 grammar: T F N E R and raw blocks", () => {
  const ops = parseAndValidateOps([
    "SW2",
    "N fact_retry fact \"retry limit is 3\"",
    "E user_input_1 supports fact_retry",
    "R task_1",
    "R old_fact stale",
    "T write_file path=src/app.js content_ref=src",
    "<<<src:text/javascript",
    "export const a = \"x=1\";",
    ">>>"
  ].join("\n"));
  expect(ops).toEqual([
    { op: "add_node", node: { id: "fact_retry", type: "fact", text: "retry limit is 3", status: "active" } },
    { op: "add_edge", from: "user_input_1", type: "supports", to: "fact_retry" },
    { op: "update_node", id: "task_1", patch: { status: "resolved" } },
    { op: "update_node", id: "old_fact", patch: { status: "stale" } },
    { op: "call_tool", tool: "write_file", args: { path: "src/app.js", content: "export const a = \"x=1\";" } }
  ]);
});

it("parses SW2 finals inline and by block ref", () => {
  expect(parseAndValidateOps('SW2\nF "Done." artifacts=a,b outcome=already_satisfied\nN a artifact "A"\nN b artifact "B"')[0]).toEqual({ op: "final", answer: "Done.", artifactId: "a", artifactIds: ["a", "b"], outcome: "already_satisfied" });
  expect(parseAndValidateOps("SW2\nF ref=ans\n<<<ans\nline one\nline two\n>>>")).toEqual([{ op: "final", answer: "line one\nline two" }]);
});

it("attaches an SW2 block to the N line with the same id", () => {
  const [op] = parseAndValidateOps("SW2\nN plan artifact \"Plan\"\n<<<plan:text/markdown\n# Plan\n>>>");
  expect(op).toMatchObject({ op: "add_node", node: { id: "plan", data: { mime: "text/markdown", content: "# Plan" } } });
});

it.each([
  ["prose line", "SW2\nI will now read the file.", /SW2 line 2: expected one of T F N E R at line start; got: I will now read/],
  ["unknown edge type", "SW2\nE a blames b", /expected E <from> <edge_type> <to> \(edge_type: [a-z_|]+\)/],
  ["missing node label", "SW2\nN fact_a fact", /expected N <id> <type> "label"/],
  ["non key=value tool arg", "SW2\nT read_file src/app.js", /expected T <tool> key=value .*"src\/app.js" is not key=value/],
  ["unknown final key", 'SW2\nF "ok" because=x', /expected F "answer".*unknown keys: because/],
  ["bad outcome", 'SW2\nF "ok" outcome=done', /outcome must be already_satisfied/],
  ["open quote", 'SW2\nF "unterminated', /expected a closed quote/],
  ["unused block", "SW2\nT read_file path=a\n<<<orphan\nx\n>>>", /expected block <<<orphan to be used by a \*_ref/],
  ["missing block ref", "SW2\nT write_file path=a content_ref=nope", /expected a <<<nope … >>> block \(referenced block is missing\)/],
  ["unclosed block", "SW2\nF ref=a\n<<<a\ntext", /expected ">>>" closing <<<a/],
  ["two finals", 'SW2\nF "a"\nF "b"', /expected at most one F line/],
  ["empty transaction", "SW2\n", /expected at least one T, F, N, E, or R line/]
])("rejects SW2 %s with an error naming the expected form", (_name, raw, message) => {
  expect(() => parseAndValidateOps(raw)).toThrow(message);
});

it("does not repair SW2 into legacy SWX semantics", () => {
  expect(() => parseAndValidateOps("SW2\n@tool read_file path=a")).toThrow(/expected one of T F N E R/);
});
