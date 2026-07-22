#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Agent, type AgentProgress, type AgentState } from "./agent/agent.js";
import { TraditionalMessagesAgent } from "./agent/baselineAgent.js";
import type { StateGraph } from "./core/types.js";
import { graphToMermaid } from "./core/visualize.js";
import { createModelFromEnv } from "./llm/factory.js";
import { mockTools } from "./tools/mockTools.js";

type CliOptions = { input?: string; maxIterations: number; showPrompt: boolean; fullState: boolean; compare: boolean; showGraph: boolean };

const enabled = stdout.isTTY && !process.env.NO_COLOR;
const paint = (open: number, close = 39) => (value: string) => enabled ? `\u001b[${open}m${value}\u001b[${close}m` : value;
const color = { bold: paint(1, 22), dim: paint(2, 22), red: paint(31), green: paint(32), yellow: paint(33), blue: paint(34), magenta: paint(35), cyan: paint(36), gray: paint(90) };
const options = parseArgs(process.argv.slice(2));
const model = createModelFromEnv();
const agent = new Agent({ model, tools: mockTools, maxIterations: options.maxIterations, traceDir: path.resolve("src/traces"), enforceCompletionEvidence: false });
const traditional = new TraditionalMessagesAgent({ model, tools: mockTools });

if (options.input) await runOnce(options.input);
else await interactive();

async function interactive(): Promise<void> {
  console.log(color.bold("StateWeave CLI"));
  console.log(color.dim("One Agent, one append-only causal graph. Type /help for commands.\n"));
  if (!stdin.isTTY) {
    for (const input of (await readPipedInput()).split(/\r?\n/)) if (await handleInput(input)) break;
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  while (!await handleInput(await rl.question(color.cyan("stateweave › ")))) continue;
  rl.close();
}

async function handleInput(raw: string): Promise<boolean> {
  const input = raw.trim();
  if (!input) return false;
  if (input === "/exit" || input === "/quit") return true;
  if (input === "/help") { printHelp(); return false; }
  if (input === "/prompt") { options.showPrompt = !options.showPrompt; line(`exact prompt: ${options.showPrompt ? "on" : "off"}`, color.yellow); return false; }
  if (input === "/full") { options.fullState = true; line("state view: full JSON", color.yellow); return false; }
  if (input === "/compact") { options.fullState = false; line("state view: compact", color.yellow); return false; }
  if (input === "/compare") { options.compare = !options.compare; line(`traditional comparison: ${options.compare ? "on" : "off"}`, color.yellow); return false; }
  if (input === "/graph") { options.showGraph = !options.showGraph; line(`Mermaid graph: ${options.showGraph ? "on" : "off"}`, color.yellow); return false; }
  if (input === "/reset") { agent.reset(); line("agent state reset", color.yellow); return false; }
  await runOnce(input).catch((error: unknown) => line(error instanceof Error ? error.message : String(error), color.red));
  return false;
}

async function runOnce(input: string): Promise<void> {
  section("USER INPUT", color.magenta);
  console.log(input);
  if (options.compare) {
    const result = await traditional.inspect(input);
    section("TRADITIONAL MESSAGES", color.gray);
    console.log(JSON.stringify(result.messages, null, 2));
    section("TRADITIONAL OUTPUT", color.gray);
    console.log(result.rawModelOutput);
  }

  for await (const event of agent.streamEvents(input)) {
    if (event.type === "metadata") {
      section("RUN", color.cyan);
      console.log(color.dim(`${event.metadata.runId} · ${event.metadata.engine}`));
      continue;
    }
    if (event.type === "progress") printProgress(event.progress);
    if (event.type === "final") {
      section("FINAL", color.magenta);
      console.log(event.result.finalAnswer);
      printState(event.result.state, event.result.graph);
      console.log(color.dim(`trace saved to src/traces/ · steps=${event.result.trace.length} · inputTokens=${event.result.metadata.totalInputTokens}`));
    }
  }
}

function printProgress(progress: AgentProgress): void {
  if (progress.phase === "context" && progress.prompt) {
    section(`STEP ${progress.iteration} · CAUSAL CONTEXT`, color.cyan);
    console.log(color.dim(`${progress.contextTokens ?? "?"} tokens · ${progress.state?.nodes.length ?? 0} stored nodes`));
    if (options.showPrompt) console.log(progress.prompt);
    else console.log(color.dim("exact prompt hidden; type /prompt or pass --prompt"));
    return;
  }
  if (progress.phase === "model") line(`step ${progress.iteration} · model`, color.green);
  if (progress.phase === "tool") line(`step ${progress.iteration} · ${progress.detail}`, color.yellow);
  if (progress.phase === "retrying") line(`step ${progress.iteration} · ${progress.detail}`, color.red);
}

function printState(state: AgentState, graph: StateGraph): void {
  section("STATE", color.cyan);
  if (options.fullState) console.log(JSON.stringify(state, null, 2));
  else {
    console.log(`${state.nodes.length} nodes · ${graph.edges.length} causal edges · frontier ${state.frontier.length}`);
    for (const node of state.nodes.slice(-12)) console.log(`  ${color.blue(node.id.slice(0, 11))} ${color.magenta(`[${node.kind}]`)} ${truncate(typeof node.payload === "string" ? node.payload : JSON.stringify(node.payload), 110)}`);
  }
  if (options.showGraph) {
    section("MERMAID GRAPH", color.blue);
    console.log(graphToMermaid(graph));
  }
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = { maxIterations: 5, showPrompt: false, fullState: false, compare: false, showGraph: false };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--input" || arg === "-i") parsed.input = requireValue(args, ++index, arg);
    else if (arg === "--max-iterations") parsed.maxIterations = Number(requireValue(args, ++index, arg));
    else if (arg === "--prompt") parsed.showPrompt = true;
    else if (arg === "--full") parsed.fullState = true;
    else if (arg === "--compare") parsed.compare = true;
    else if (arg === "--graph") parsed.showGraph = true;
    else positional.push(arg);
  }
  if (!parsed.input && positional.length) parsed.input = positional.join(" ");
  if (!Number.isInteger(parsed.maxIterations) || parsed.maxIterations < 1) throw new Error("--max-iterations must be a positive integer");
  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(["/prompt toggle exact compiled context", "/full show complete state JSON", "/compact show compact state", "/graph toggle Mermaid graph", "/compare toggle transcript comparison", "/reset clear state", "/exit quit"].join("\n"));
}

async function readPipedInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function section(title: string, painter: (value: string) => string): void { console.log(`\n${painter(color.bold(`── ${title} ──`))}`); }
function line(value: string, painter: (value: string) => string): void { console.log(painter(value)); }
function truncate(value: string, limit: number): string { return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`; }
