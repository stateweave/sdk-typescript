import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { GraphFrameAgent as Agent } from "../src/agent/graphFrameAgent.js";
import { runStateWeave, StateWeaveRunError, streamStateWeave } from "../src/agent/stateweaveRunner.js";
import { applyOps } from "../src/core/applyOps.js";
import { createInitialGraphFrame } from "../src/core/graph.js";
import type { StateWeaveStreamEvent } from "../src/core/types.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";
import { createFileSystemTools } from "../src/tools/fileSystemTools.js";
import type { Tool } from "../src/tools/types.js";

it("automatically connects pending inputs and model-added nodes", async () => {
  const firstFrame = applyOps(
    createInitialGraphFrame({ objective: "Draw SVG", input: "Create a butterfly", availableActions: [] }),
    [{ op: "final", answer: "Butterfly done." }]
  );
  const model = new SequenceModel([[
    "SWX/1",
    "@node house_svg svg_artifact \"House SVG\" mime=image/svg+xml",
    "@final house_svg",
    "<<<house_svg:image/svg+xml",
    "<svg><rect width=\"10\" height=\"10\" /></svg>",
    ">>>"
  ].join("\n")]);

  const result = await runStateWeave({ model, tools: [], maxIterations: 1 }, "Create a house", { frame: firstFrame });

  expect(result.metadata.retryCount).toBe(0);
  expect(result.metadata.status).toBe("done");
  expect(result.frame.graph).toEqual(result.graph);
  expect(result.metadata.tools).toEqual([]);
  expect(result.trace).toHaveLength(1);
  expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "system_root", to: "user_input_2", type: "follows" }));
  expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "assistant_output_2", to: "house_svg", type: "creates" }));
});

it("supports compact traces for long-running agents without retaining frame graphs or prompts", async () => {
  const result = await runStateWeave(
    { model: new SequenceModel(["SWX/1\n@final \"done\""]), tools: [], maxIterations: 1, traceMode: "compact" },
    "Complete the task"
  );

  expect(result.finalAnswer).toBe("done");
  expect(result.trace[0]?.prompt).toBe("");
  expect(result.trace[0]?.streamedTokens).toEqual([]);
  expect(result.trace[0]?.frameBefore.graph).toEqual({ nodes: [], edges: [] });
  expect(result.graph.nodes.length).toBeGreaterThan(0);
});

it("runs workspace write/edit tools end to end with SWX block-ref args", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-runner-tools-"));
  try {
    const model = new SequenceModel([
      [
        "SWX/1",
        "@edge system_root follows user_input_1",
        "@tool write_file file_path=created_with_tool.svg content_ref=svg_1",
        "<<<svg_1:image/svg+xml",
        "<svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\" /></svg>",
        ">>>"
      ].join("\n"),
      [
        "SWX/1",
        "@tool edit_file file_path=created_with_tool.svg old_string_ref=old_1 new_string_ref=new_1",
        "<<<old_1:text/plain",
        "<rect width=\"10\" height=\"10\" />",
        ">>>",
        "<<<new_1:text/plain",
        "<circle cx=\"5\" cy=\"5\" r=\"4\" />",
        ">>>"
      ].join("\n"),
      "SWX/1\n@final \"Created and edited the SVG file.\""
    ]);

    const result = await runStateWeave({ model, tools: createFileSystemTools({ rootDir: root }), maxIterations: 3 }, "Create and refine an SVG file");
    const content = await readFile(path.join(root, "created_with_tool.svg"), "utf8");

    expect(content).toBe("<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>");
    expect(result.finalAnswer).toBe("Created and edited the SVG file.");
    expect(result.trace.flatMap((step) => step.parsedOps)).not.toContainEqual(expect.objectContaining({ op: "add_node", node: expect.objectContaining({ id: "svg_1" }) }));
    expect(result.graph.nodes.filter((node) => node.type === "tool_result")).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("records failed mutations as rejected evidence without committing proposed semantic ops", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-failed-mutation-"));
  try {
    const tools = createFileSystemTools({ rootDir: root });
    await tools.find((tool) => tool.name === "write_file")?.execute({ file_path: "config.txt", content: "retryLimit=3" });
    const model = new SequenceModel([
      "SWX/1\n@tool read_file file_path=config.txt",
      "SWX/1\n@node false_claim decision \"retry updated\"\n@tool edit_file file_path=config.txt old_string=retryLimit: new_string=retryLimit=4",
      "SWX/1\n@tool edit_file file_path=config.txt old_string=retryLimit=3 new_string=retryLimit=4",
      "SWX/1\n@final \"Updated config.txt to retryLimit=4.\""
    ]);

    const result = await runStateWeave({ model, tools, maxIterations: 4 }, "Fix file config.txt by updating retryLimit to 4");

    expect(await readFile(path.join(root, "config.txt"), "utf8")).toBe("retryLimit=4");
    expect(result.graph.nodes).not.toContainEqual(expect.objectContaining({ id: "false_claim" }));
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ type: "tool_result", status: "rejected" }));
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ type: "file", status: "active", data: expect.objectContaining({ path: "config.txt", canonical: true }) }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("counts full-shell workspace changes as mutation evidence", async () => {
  const bashTool: Tool = {
    name: "bash_command",
    description: "Run a full shell command.",
    schema: z.object({ command: z.string() }),
    execute: async () => ({ exitCode: 0, workspace_mutated: true, mutated_paths: ["app.js"], stdout: "", stderr: "" })
  };
  const model = new SequenceModel([
    "SWX/1\n@node task_app task \"Build app\" status=active\n@edge user_input_1 addresses task_app\n@tool bash_command command=\"printf ready > app.js\"",
    "SWX/1\n@update task_app status=resolved\n@final \"Created app.js through the sandbox shell.\""
  ]);

  const result = await runStateWeave({ model, tools: [bashTool], nodeTypes: ["task"], maxIterations: 2, maxNoProgressIterations: 1 }, "Create app.js");

  expect(result.finalAnswer).toContain("Created app.js");
  expect(result.graph.nodes).toContainEqual(expect.objectContaining({ type: "tool_result", data: expect.objectContaining({ result: expect.objectContaining({ mutated_paths: ["app.js"] }) }) }));
});

it("does not let generated test logs reset the no-progress watchdog", async () => {
  const bashTool: Tool = {
    name: "bash_command",
    description: "Run a full shell command.",
    schema: z.object({ command: z.string() }),
    execute: async () => ({ exitCode: 0, workspace_mutated: true, mutated_paths: ["vitest_single.log"], stdout: "", stderr: "" })
  };
  const model = new SequenceModel([
    "SWX/1\n@node task_app task \"Build app\" status=active\n@edge user_input_1 addresses task_app\n@tool bash_command command=\"npm test > vitest_single.log\""
  ]);

  await expect(runStateWeave({ model, tools: [bashTool], nodeTypes: ["task"], maxIterations: 2, maxNoProgressIterations: 1 }, "Create app.js"))
    .rejects.toThrow("No successful workspace mutation occurred in 1 consecutive model iterations");
});

it("accepts a successful post-mutation read as verification evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-read-verification-"));
  try {
    const model = new SequenceModel([
      "SWX/1\n@tool write_file file_path=config.txt content=ready",
      "SWX/1\n@tool read_file file_path=config.txt",
      "SWX/1\n@final \"Wrote and verified config.txt.\""
    ]);

    const result = await runStateWeave({ model, tools: createFileSystemTools({ rootDir: root }), maxIterations: 3 }, "Write config.txt and verify it");

    expect(result.finalAnswer).toBe("Wrote and verified config.txt.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires configured semantic task and evidence nodes for tool-using work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-semantic-work-"));
  try {
    const tools = createFileSystemTools({ rootDir: root });
    await tools.find((tool) => tool.name === "write_file")?.execute({ file_path: "config.txt", content: "ready" });
    const model = new SequenceModel([
      "SWX/1\n@tool read_file file_path=config.txt",
      "SWX/1\n@node task_config task \"Verify config\" status=active\n@edge user_input_1 addresses task_config\n@tool read_file file_path=config.txt",
      "SWX/1\n@node check_config test_result \"config read verified\" status=resolved\n@edge tool_result_2 validates check_config\n@edge check_config validates task_config\n@update task_config status=resolved\n@final \"Config is ready and verified.\""
    ]);

    const result = await runStateWeave({ model, tools, nodeTypes: ["task", "file", "symbol", "decision", "constraint", "test_result"], maxIterations: 3 }, "Read config.txt and verify it");

    expect(result.metadata.retryCount).toBe(1);
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ id: "task_config", type: "task", status: "resolved" }));
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ id: "check_config", type: "test_result", status: "resolved" }));
    expect(result.graph.edges).toContainEqual(expect.objectContaining({ from: "task_config", to: "tool_call_2" }));
    expect(result.trace[0]?.error).toMatch(/first tool transaction must create/);
    expect(result.trace[0]?.prompt).toContain("preferred suggestions, not a whitelist");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires requested restart and smoke evidence before finalizing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-runtime-evidence-"));
  try {
    const appControl: Tool = {
      name: "app_control",
      description: "Run fixed app actions.",
      schema: z.object({ action: z.enum(["restart", "smoke"]) }),
      execute: async () => ({ ok: true, healthy: true, pageOk: true })
    };
    const model = new SequenceModel([
      "SWX/1\n@tool write_file file_path=config.txt content=ready",
      "SWX/1\n@final \"Wrote config.txt and restarted it.\"",
      "SWX/1\n@tool app_control action=restart",
      "SWX/1\n@final \"Wrote config.txt, restarted it, and smoke-checked it successfully.\""
    ]);

    const result = await runStateWeave({ model, tools: [...createFileSystemTools({ rootDir: root }), appControl], maxIterations: 4 }, "Write config.txt, restart, and smoke-check it");

    expect(result.metadata.retryCount).toBe(1);
    expect(result.trace[1]?.error).toMatch(/requests a restart/);
    expect(result.finalAnswer).toContain("smoke-checked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("allows an explicitly verified already-satisfied mutation without a fake edit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-already-satisfied-"));
  try {
    const tools = createFileSystemTools({ rootDir: root });
    await tools.find((tool) => tool.name === "write_file")?.execute({ file_path: "server.js", content: "export const ready = true;" });
    const appControl: Tool = {
      name: "app_control",
      description: "Run fixed app checks.",
      schema: z.object({ action: z.literal("check") }),
      execute: async () => ({ ok: true })
    };
    const model = new SequenceModel([
      "SWX/1\n@tool read_file file_path=server.js",
      "SWX/1\n@tool app_control action=check",
      "SWX/1\n@final \"The requested implementation was already present in server.js and checks pass; no files were changed.\" outcome=already_satisfied"
    ]);

    const result = await runStateWeave({ model, tools: [...tools, appControl], maxIterations: 3 }, "Implement the feature in server.js and run checks");

    expect(result.finalAnswer).toContain("already present");
    expect(result.trace.at(-1)?.parsedOps).toContainEqual(expect.objectContaining({ op: "final", outcome: "already_satisfied" }));
    expect(await readFile(path.join(root, "server.js"), "utf8")).toBe("export const ready = true;");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects already-satisfied completion without inspection evidence", async () => {
  const model = new SequenceModel([
    "SWX/1\n@final \"It was already implemented.\" outcome=already_satisfied"
  ]);

  await expect(runStateWeave({ model, tools: [], maxIterations: 1 }, "Implement the feature in server.js"))
    .rejects.toThrow(/requires successful read_file evidence/);
});

it("forces read and bash observations into a separate model iteration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-observation-loop-"));
  try {
    const tools = createFileSystemTools({ rootDir: root });
    await tools.find((tool) => tool.name === "write_file")?.execute({ file_path: "source.txt", content: "observed value" });
    const model = new SequenceModel([
      "SWX/1\n@edge system_root follows user_input_1\n@tool read_file file_path=source.txt\n@final \"I read it.\"",
      "SWX/1\n@edge system_root follows user_input_1\n@tool read_file file_path=source.txt",
      "SWX/1\n@tool write_file file_path=copy.txt content=observed_value",
      "SWX/1\n@final \"Copied the observed value.\""
    ]);

    const result = await runStateWeave({ model, tools, maxIterations: 4 }, "Read source and make a copy");

    expect(result.metadata.retryCount).toBe(1);
    expect(result.trace[0].error).toMatch(/evidence-producing and isolated/);
    expect(result.trace[1].parsedOps).toContainEqual(expect.objectContaining({ op: "call_tool", tool: "read_file" }));
    expect(result.finalAnswer).toBe("Copied the observed value.");
    expect(await readFile(path.join(root, "copy.txt"), "utf8")).toBe("observed_value");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("returns long final_ref answers with multiple artifact refs end to end", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-final-ref-"));
  try {
    const model = new SequenceModel([
      [
        "SWX/1",
        "@node snake artifact \"Snake HTML\" mime=text/html",
        "@node index_page artifact \"Game index\" mime=text/html",
        "@tool write_file file_path=snake.html content_ref=snake_html",
        "<<<snake_html:text/html",
        "<html>Snake</html>",
        ">>>"
      ].join("\n"),
      [
        "SWX/1",
        "@tool write_file file_path=index.html content_ref=index_html",
        "<<<index_html:text/html",
        "<html><a href=\"snake.html\">Snake</a></html>",
        ">>>"
      ].join("\n"),
      [
        "SWX/1",
        "@final_ref final_answer artifacts=snake,index_page",
        "<<<final_answer:text/markdown",
        "Created the game files:\n- snake.html\n- index.html",
        ">>>"
      ].join("\n")
    ]);

    const result = await runStateWeave({ model, tools: createFileSystemTools({ rootDir: root }), maxIterations: 3 }, "Create one game and index files");

    expect(result.finalAnswer).toBe("Created the game files:\n- snake.html\n- index.html");
    expect(result.graph.nodes).not.toContainEqual(expect.objectContaining({ id: "final_answer" }));
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ type: "assistant_output", text: result.finalAnswer, data: { artifactId: "snake", artifactIds: ["snake", "index_page"] } }));
    expect(await readFile(path.join(root, "snake.html"), "utf8")).toBe("<html>Snake</html>");
    expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("snake.html");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("spawns graph workers, streams scheduler events, merges results, and synthesizes final output", async () => {
  const events: StateWeaveStreamEvent[] = [];
  for await (const event of streamStateWeave({ model: new WorkerSchedulerModel(), tools: [], maxIterations: 4 }, "Build a game with independent UI and logic")) events.push(event);

  const final = events.find((event) => event.type === "final");
  expect(final?.type).toBe("final");
  if (final?.type !== "final") throw new Error("missing final event");

  expect(events).toContainEqual(expect.objectContaining({ type: "worker", phase: "started", worker: expect.objectContaining({ id: "ui" }) }));
  expect(events).toContainEqual(expect.objectContaining({ type: "worker", phase: "started", worker: expect.objectContaining({ id: "logic" }) }));
  expect(events).toContainEqual(expect.objectContaining({ type: "worker", phase: "merged" }));
  expect(final.result.finalAnswer).toBe("Built the UI and logic workers.");
  expect(final.result.graph.nodes).toContainEqual(expect.objectContaining({ id: "worker_task_ui", type: "worker_task", status: "resolved" }));
  expect(final.result.graph.nodes).toContainEqual(expect.objectContaining({ id: "worker_result_ui", type: "worker_result", text: "UI worker ready." }));
  expect(final.result.graph.nodes).toContainEqual(expect.objectContaining({ id: "ui_panel", type: "artifact" }));
  expect(final.result.graph.nodes).toContainEqual(expect.objectContaining({ id: "logic_rules", type: "decision" }));
  expect(final.result.trace).toHaveLength(2);
  expect(final.result.trace[1].prompt).toContain("worker_result_ui");
});

it("stops a tool run after a bounded interval without workspace mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-no-progress-"));
  try {
    const model = new SequenceModel([
      "SWX/1\n@node task_1 task \"Build\" status=active\n@edge user_input_1 addresses task_1\n@tool write_file file_path=app.js content=ready",
      "SWX/1\n@node thought_2 note \"still thinking\"",
      "SWX/1\n@node thought_3 note \"still thinking again\""
    ]);
    await expect(runStateWeave({ model, tools: createFileSystemTools({ rootDir: root }), maxIterations: 10, maxNoProgressIterations: 2 }, "Build app.js"))
      .rejects.toThrow(/No successful workspace mutation occurred in 2 consecutive model iterations/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("throws a clear recursion-limit error when maxIterations is exhausted", async () => {
  const output = "SWX/1\n@edge system_root follows user_input_1\n@node note_1 note \"Still working\"\n@edge user_input_1 creates note_1";

  await expect(runStateWeave({ model: new SequenceModel([output]), tools: [], maxIterations: 1 }, "Keep going forever")).rejects.toThrow(StateWeaveRunError);
  await expect(runStateWeave({ model: new SequenceModel([output]), tools: [], maxIterations: 1 }, "Keep going forever")).rejects.toThrow(/Recursion limit reached.*maxIterations/);
  try {
    await runStateWeave({ model: new SequenceModel([output]), tools: [], maxIterations: 1, traceMode: "compact" }, "Keep going forever");
    throw new Error("expected compact recursion failure");
  } catch (error) {
    expect(error).toBeInstanceOf(StateWeaveRunError);
    expect((error as StateWeaveRunError).trace[0]?.frameAfter.graph).toEqual({ nodes: [], edges: [] });
    expect((error as StateWeaveRunError).frame?.graph.nodes).toContainEqual(expect.objectContaining({ id: "note_1" }));
  }
});

it("shares the unchanged graph across rejected retries instead of cloning historical payloads", async () => {
  const frame = createInitialGraphFrame({ objective: "Retry safely", input: "Finish the task", availableActions: [] });
  frame.graph.nodes[0]!.data = { payload: "x".repeat(200_000) };
  const model = new SequenceModel([
    "SWX/1\n@edge malformed",
    "SWX/1\n@final \"Recovered after the malformed operation.\""
  ]);

  const result = await runStateWeave({ model, tools: [], maxIterations: 2 }, "Finish the task", { frame });

  expect(result.trace).toHaveLength(2);
  expect(result.trace[0]!.frameBefore.graph).toBe(result.trace[0]!.frameAfter.graph);
  expect(result.trace[0]!.frameAfter.graph).toBe(result.trace[1]!.frameBefore.graph);
  expect(result.finalAnswer).toContain("Recovered");
});

it("cancels an active provider stream through the run signal", async () => {
  const controller = new AbortController();
  const run = runStateWeave({ model: new AbortableModel(), tools: [], maxIterations: 3 }, "Wait forever", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new DOMException("stopped", "AbortError"));

  await expect(run).rejects.toMatchObject({ name: "AbortError" });
});

it("Agent streams final text by default and keeps one graph across user turns", async () => {
  const agent = new Agent({
    model: new SequenceModel([
      "SWX/1\n@edge system_root follows user_input_1\n@node intent_1 intent \"Build todo app\"\n@edge user_input_1 creates intent_1\n@final \"Started todo app.\"",
      "SWX/1\n@edge intent_1 follows user_input_2\n@node constraint_1 constraint \"Add keyboard shortcuts\"\n@edge user_input_2 constrains constraint_1\n@final \"Added shortcut requirement.\""
    ]),
    nodeTypes: ["intent", "constraint", "artifact"],
    maxIterations: 2,
    tools: []
  });

  const firstChunks: string[] = [];
  for await (const chunk of agent.streamText("Build a todo app")) firstChunks.push(chunk);
  const second = await agent.run("Add keyboard shortcuts.");

  expect(firstChunks.join("")).toBe("Started todo app.");
  expect(second.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_1", text: "Build a todo app" }));
  expect(second.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_2", text: "Add keyboard shortcuts." }));
  expect(second.trace[0].prompt).toContain("semanticNodeTypes:\n- intent\n- constraint\n- artifact");
  expect(agent.getFrame()?.graph.nodes).toHaveLength(second.graph.nodes.length);
});

it("Agent serializes concurrent stateful turns and commits them in invocation order", async () => {
  const agent = new Agent({ model: new ConcurrentModel(), tools: [], maxIterations: 2 });

  const [slow, fast] = await Promise.all([agent.run("slow branch"), agent.run("fast branch")]);
  const frame = agent.getFrame();

  expect(slow.finalAnswer).toBe("slow done");
  expect(fast.finalAnswer).toBe("fast done");
  expect(frame?.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_1", text: "slow branch" }));
  expect(frame?.graph.nodes).toContainEqual(expect.objectContaining({ id: "user_input_2", text: "fast branch" }));
  expect(frame?.graph.nodes.filter((node) => node.type === "assistant_output")).toHaveLength(2);
  expect(new Set(frame?.graph.nodes.filter((node) => node.type === "assistant_output").map((node) => node.id)).size).toBe(2);
});

it("does not commit a failed stateful turn", async () => {
  const agent = new Agent({
    model: new SequenceModel(["SWX/1\n@final \"committed\"", "SWX/1\n@ndoe broken fact \"bad\""]),
    tools: [],
    maxIterations: 1
  });
  await agent.run("first");
  const before = JSON.stringify(agent.getFrame());
  await expect(agent.run("failed second")).rejects.toThrow(/Unknown SWX command/);
  expect(JSON.stringify(agent.getFrame())).toBe(before);
});

it("resetFrame invalidates an in-flight stateful commit", async () => {
  const agent = new Agent({ model: new ConcurrentModel(), tools: [], maxIterations: 1 });
  const active = agent.run("slow branch");
  await new Promise((resolve) => setTimeout(resolve, 5));
  agent.resetFrame();
  await expect(active).resolves.toMatchObject({ finalAnswer: "slow done" });
  expect(agent.getFrame()).toBeUndefined();
});

it("releases the state lock when a stream consumer closes early", async () => {
  const agent = new Agent({ model: new ConcurrentModel(), tools: [], maxIterations: 1 });
  const iterator = agent.stream("abandoned stream")[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.type).toBe("metadata");
  await iterator.return?.();
  await expect(agent.run("fast branch")).resolves.toMatchObject({ finalAnswer: "fast done" });
});

it("rejects an impossible prompt budget before calling the provider", async () => {
  let calls = 0;
  const model: Model = {
    async complete() { calls += 1; return { text: "SWX/1\n@final \"unexpected\"" }; },
    async *stream() { calls += 1; yield { type: "token", token: "SWX/1\n@final \"unexpected\"" }; }
  };
  const agent = new Agent({ model, tools: [], maxIterations: 1, maxPromptTokens: 256, systemPrompt: "x".repeat(20_000) });
  await expect(agent.run("never call the model")).rejects.toThrow(/cannot fit/i);
  expect(calls).toBe(0);
  expect(agent.getFrame()).toBeUndefined();
});

class WorkerSchedulerModel implements Model {
  async complete(input: ModelInput): Promise<ModelOutput> {
    return { text: this.output(input) };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: this.output(input) };
  }

  private output(input: ModelInput): string {
    const objective = input.frame?.frame.objective ?? "";
    if (objective.includes("Build the UI shell")) {
      return [
        "SWX/1",
        "@node ui_panel artifact \"HTML UI panel\" mime=text/html",
        "@edge worker_task_ui creates ui_panel",
        "@final \"UI worker ready.\" artifact=ui_panel"
      ].join("\n");
    }
    if (objective.includes("Build game logic")) {
      return [
        "SWX/1",
        "@node logic_rules decision \"Game loop and scoring rules\"",
        "@edge worker_task_logic creates logic_rules",
        "@final \"Logic worker ready.\""
      ].join("\n");
    }
    if (input.frame?.graph.nodes.some((node) => node.id === "worker_result_ui")) {
      return "SWX/1\n@final \"Built the UI and logic workers.\" artifacts=ui_panel";
    }
    return [
      "SWX/1",
      "@edge system_root follows user_input_1",
      "@worker ui objective=\"Build the UI shell\" focus=user_input_1",
      "@worker logic objective=\"Build game logic\" focus=user_input_1"
    ].join("\n");
  }
}

class ConcurrentModel implements Model {
  async complete(input: ModelInput): Promise<ModelOutput> {
    return { text: await this.output(input) };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: await this.output(input) };
  }

  private async output(input: ModelInput): Promise<string> {
    const latest = input.frame?.frame.latestInputNodeId ?? "user_input_1";
    const slow = input.frame?.graph.nodes.find((node) => node.id === latest)?.text.includes("slow") ?? false;
    if (slow) await new Promise((resolve) => setTimeout(resolve, 25));
    const label = slow ? "slow" : "fast";
    return `SWX/1\n@edge system_root follows ${latest}\n@node ${label}_branch branch_work \"${label} branch\"\n@edge ${latest} creates ${label}_branch\n@final \"${label} done\"`;
  }
}

class AbortableModel implements Model {
  async complete(input: ModelInput): Promise<ModelOutput> {
    await waitForAbort(input.signal);
    return { text: "SWX/1\n@final \"unreachable\"" };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    await waitForAbort(input.signal);
    yield { type: "token", token: "SWX/1\n@final \"unreachable\"" };
  }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return Promise.reject(new Error("missing abort signal"));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

class SequenceModel implements Model {
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async complete(_input: ModelInput): Promise<ModelOutput> {
    return { text: this.next() };
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "token", token: this.next() };
  }

  private next(): string {
    return this.outputs[Math.min(this.index++, this.outputs.length - 1)] ?? "SWX/1\n@final \"done\"";
  }
}
