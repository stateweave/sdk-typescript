#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { applyOps } from "./core/applyOps.js";
import { createInitialGraphFrame } from "./core/graph.js";
import { serializeGraphFrame } from "./core/serialize.js";
import { parseAndValidateOps } from "./core/validateOps.js";
import { graphToMermaid } from "./core/visualize.js";
import { createModelFromEnv } from "./llm/factory.js";
import { MockModel, type Model } from "./llm/model.js";

export type CliOptions = { input?: string; configuredModel: boolean; showPrompt: boolean; showGraph: boolean; help: boolean };

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { configuredModel: false, showPrompt: false, showGraph: false, help: false };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--input" || arg === "-i") {
      if (options.input !== undefined) throw new Error("Supply only one task");
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a task`);
      options.input = value;
    } else if (arg === "--live") options.configuredModel = true;
    else if (arg === "--prompt") options.showPrompt = true;
    else if (arg === "--graph") options.showGraph = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (options.input !== undefined && positional.length) throw new Error("Supply one task with --input or positional text, not both");
  if (positional.length) options.input = positional.join(" ");
  return options;
}

export async function inspectPrimitiveTask(input: string, model: Model = new MockModel()) {
  if (!input.trim()) throw new Error("A non-empty task is required");
  const before = createInitialGraphFrame({
    objective: input,
    input,
    systemPrompt: "Inspect one graph transaction. No tools or workers are available. Return valid SW2 graph operations; do not claim tool execution.",
    availableActions: []
  });
  const prompt = serializeGraphFrame(before);
  const output = await model.complete({ frame: before, prompt, mode: "graph_ops" });
  const ops = parseAndValidateOps(output.text);
  if (ops.some((op) => op.op === "call_tool" || op.op === "spawn_worker")) {
    throw new Error("The primitive inspector does not execute tools or workers; the transaction was not applied");
  }
  const after = applyOps(before, ops);
  return { before, prompt, rawModelOutput: output.text, ops, after };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log("stateweave [--input TASK] [--prompt] [--graph] [--live]\nOne GraphFrame -> GraphOps -> StateGraph transaction. Offline MockModel by default, regardless of provider environment variables.\n--live explicitly uses the environment-configured model and may call a paid provider. The CLI never loads .env. No tools or retries.");
    return;
  }
  const input = options.input ?? await readTask();
  if (!input.trim()) throw new Error("A non-empty task is required");
  const model = options.configuredModel ? createModelFromEnv() : new MockModel();
  console.log(options.configuredModel
    ? "Explicit live opt-in: one configured-model completion; provider charges may apply."
    : "Offline mock fixture: output is not evidence of task correctness.");

  const result = await inspectPrimitiveTask(input, model);
  printSection("GRAPHFRAME BEFORE", result.before);
  if (options.showPrompt) printSection("COMPILED PROMPT", result.prompt);
  printSection("RAW OUTPUT", result.rawModelOutput);
  printSection("VALIDATED GRAPHOPS", result.ops);
  printSection("STATEGRAPH AFTER", result.after.graph);
  printSection("FRAME AFTER", result.after.frame);
  console.log(`\nTransition: ${result.before.graph.nodes.length} -> ${result.after.graph.nodes.length} nodes; ${result.before.graph.edges.length} -> ${result.after.graph.edges.length} edges. Prior snapshot preserved.`);
  if (options.showGraph) printSection("MERMAID", graphToMermaid(result.after.graph));
}

async function readTask(): Promise<string> {
  if (stdin.isTTY) {
    const reader = createInterface({ input: stdin, output: stdout });
    try { return await reader.question("Task: "); }
    finally { reader.close(); }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

function printSection(title: string, value: unknown): void {
  console.log(`\n── ${title} ──\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);
}

if (process.argv[1] && existsSync(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
