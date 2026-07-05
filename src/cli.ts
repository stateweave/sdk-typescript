#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TraditionalMessagesAgent } from "./agent/baselineAgent.js";
import { StateWeaveAgent } from "./agent/stateweaveAgent.js";
import type { GraphFrame, GraphOp } from "./core/types.js";
import { serializeGraphFrame } from "./core/serialize.js";
import { graphToMermaid } from "./core/visualize.js";
import { createModelFromEnv } from "./llm/factory.js";
import { mockTools } from "./tools/mockTools.js";

type CliOptions = {
  input?: string;
  maxIterations: number;
  showPrompt: boolean;
  fullFrame: boolean;
  compare: boolean;
  showGraph: boolean;
};

const enabled = stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code: number, close = 39) => (text: string) => (enabled ? `\u001b[${code}m${text}\u001b[${close}m` : text);
const color = {
  reset: (text: string) => (enabled ? `\u001b[0m${text}` : text),
  bold: (text: string) => (enabled ? `\u001b[1m${text}\u001b[22m` : text),
  dim: (text: string) => (enabled ? `\u001b[2m${text}\u001b[22m` : text),
  gray: ansi(90),
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  blue: ansi(34),
  magenta: ansi(35),
  cyan: ansi(36)
};
const palette = {
  red: color.red,
  green: color.green,
  yellow: color.yellow,
  blue: color.blue,
  magenta: color.magenta,
  cyan: color.cyan,
  gray: color.gray
};

const options = parseArgs(process.argv.slice(2));
const model = createModelFromEnv();
const agent = new StateWeaveAgent({
  model,
  tools: mockTools,
  maxIterations: options.maxIterations,
  traceDir: path.resolve("src/traces")
});
const traditional = new TraditionalMessagesAgent({ model, tools: mockTools });

if (options.input) await runOnce(agent, traditional, options.input, undefined, options);
else await interactive(agent, traditional, options);

async function interactive(agent: StateWeaveAgent, traditional: TraditionalMessagesAgent, options: CliOptions): Promise<void> {
  header();
  let sessionFrame: GraphFrame | undefined;

  if (!stdin.isTTY) {
    for (const input of (await readPipedInput()).split(/\r?\n/)) {
      const next = await handleInput(agent, traditional, input, sessionFrame, options);
      if (next.exit) break;
      sessionFrame = next.frame;
    }
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  while (true) {
    const next = await handleInput(agent, traditional, await rl.question(color.cyan("stateweave › ")), sessionFrame, options);
    if (next.exit) break;
    sessionFrame = next.frame;
  }
  rl.close();
}

async function handleInput(
  agent: StateWeaveAgent,
  traditional: TraditionalMessagesAgent,
  rawInput: string,
  sessionFrame: GraphFrame | undefined,
  options: CliOptions
): Promise<{ frame: GraphFrame | undefined; exit?: boolean }> {
  const input = rawInput.trim();
  if (!input) return { frame: sessionFrame };
  if (input === "/exit" || input === "/quit") return { frame: sessionFrame, exit: true };
  if (input === "/help") {
    printHelp();
    return { frame: sessionFrame };
  }
  if (input === "/prompt") {
    options.showPrompt = !options.showPrompt;
    line(`exact prompt: ${options.showPrompt ? "on" : "off"}`, "yellow");
    return { frame: sessionFrame };
  }
  if (input === "/full") {
    options.fullFrame = true;
    line("frame view: full JSON", "yellow");
    return { frame: sessionFrame };
  }
  if (input === "/compact") {
    options.fullFrame = false;
    line("frame view: compact", "yellow");
    return { frame: sessionFrame };
  }
  if (input === "/compare") {
    options.compare = !options.compare;
    line(`traditional messages comparison: ${options.compare ? "on" : "off"}`, "yellow");
    return { frame: sessionFrame };
  }
  if (input === "/graph") {
    options.showGraph = !options.showGraph;
    line(`mermaid graph view: ${options.showGraph ? "on" : "off"}`, "yellow");
    return { frame: sessionFrame };
  }
  if (input === "/reset") {
    line("short-term graph memory reset", "yellow");
    return { frame: undefined };
  }

  const nextFrame = await runOnce(agent, traditional, input, sessionFrame, options).catch((error: unknown) => {
    line(errorMessage(error), "red");
    return undefined;
  });
  return { frame: nextFrame ?? sessionFrame };
}

async function runOnce(agent: StateWeaveAgent, traditional: TraditionalMessagesAgent, input: string, sessionFrame: GraphFrame | undefined, options: CliOptions): Promise<GraphFrame | undefined> {
  section("USER INPUT", "magenta");
  console.log(input);

  if (options.compare) await printTraditionalComparison(traditional, input);

  let latestFrame: GraphFrame | undefined;

  for await (const event of agent.stream(input, { frame: sessionFrame })) {
    if (event.type === "frame" && event.phase === "before") {
      section(`STEP ${event.step} · MODEL IN`, "cyan");
      printFrame(event.frame, options.fullFrame);
      if (options.showPrompt) {
        section(`STEP ${event.step} · EXACT PROMPT`, "blue");
        console.log(color.dim(serializeGraphFrame(event.frame)));
      } else {
        console.log(color.dim("exact prompt hidden; type /prompt or pass --prompt to show it"));
      }
      section(`STEP ${event.step} · MODEL OUT STREAM`, "green");
    }

    if (event.type === "token") stdout.write(color.green(event.token));

    if (event.type === "ops") {
      stdout.write(color.reset("\n"));
      section(`STEP ${event.step} · PARSED GRAPH OPS`, "yellow");
      printOps(event.ops);
    }

    if (event.type === "error") {
      stdout.write(color.reset("\n"));
      section(`STEP ${event.step} · GRAPH OPS REJECTED`, "red");
      console.log(color.red(event.message));
      if (event.retryable) console.log(color.dim("retrying with the same graph state and structured error feedback"));
    }

    if (event.type === "worker") {
      if (event.phase === "token") stdout.write(color.cyan(event.token ?? ""));
      else {
        stdout.write(color.reset("\n"));
        section(`STEP ${event.step} · WORKER ${event.worker.id} · ${event.phase.toUpperCase()}`, "cyan");
        console.log(color.cyan(event.worker.finalAnswer ?? event.worker.error ?? event.worker.objective));
      }
    }

    if (event.type === "frame" && event.phase === "after") {
      latestFrame = event.frame;
      section(`STEP ${event.step} · STATE AFTER`, "cyan");
      printFrame(event.frame, options.fullFrame);
      if (options.showGraph) {
        section(`STEP ${event.step} · MERMAID GRAPH`, "blue");
        console.log(color.dim(graphToMermaid(event.frame.graph)));
      }
    }

    if (event.type === "final") {
      section("FINAL", "magenta");
      console.log(event.result.finalAnswer);
      console.log(color.dim(`trace saved to src/traces/ · steps=${event.result.trace.length}`));
    }
  }

  return latestFrame;
}

async function printTraditionalComparison(traditional: TraditionalMessagesAgent, input: string): Promise<void> {
  section("TRADITIONAL MODEL IN · MESSAGES", "gray");
  const result = await traditional.inspect(input);
  printJson(result.messages);
  section("TRADITIONAL MODEL OUT · ASSISTANT TEXT", "gray");
  console.log(color.gray(result.rawModelOutput));
}

function printFrame(frame: GraphFrame, full: boolean): void {
  if (full) {
    printJson(frame);
    return;
  }

  console.log(`${label("objective")} ${frame.frame.objective}`);
  console.log(`${label("focus")} ${frame.frame.currentFocus}`);
  console.log(`${label("focus node")} ${frame.frame.focusNodeId ?? "unknown"}`);
  console.log(`${label("active input")} ${frame.frame.activeUserInputNodeId ?? frame.frame.latestInputNodeId ?? "unknown"}`);
  if (frame.frame.activeConstraints.length) console.log(`${label("constraints")} ${frame.frame.activeConstraints.join("; ")}`);
  console.log(`${label("graph")} ${frame.graph.nodes.length} nodes · ${frame.graph.edges.length} edges`);

  for (const node of frame.graph.nodes) {
    const status = node.status ? color.gray(` ${node.status}`) : "";
    console.log(`  ${color.blue(node.id)} ${color.magenta(`[${node.type}]`)}${status} ${truncate(node.text, 110)}`);
  }

  if (frame.graph.edges.length) {
    console.log(color.gray("  edges"));
    for (const edge of frame.graph.edges) console.log(`  ${color.gray(`${edge.from} -${edge.type}-> ${edge.to}`)}`);
  }
}

function printOps(ops: GraphOp[]): void {
  for (const op of ops) {
    if (op.op === "add_node") console.log(`${opLabel(op.op)} ${op.node.id} ${color.magenta(`[${op.node.type}]`)} ${truncate(op.node.text, 120)}`);
    else if (op.op === "add_edge") console.log(`${opLabel(op.op)} ${op.from} ${color.gray(op.type)} ${op.to}`);
    else if (op.op === "update_node") console.log(`${opLabel(op.op)} ${op.id} ${JSON.stringify(op.patch)}`);
    else if (op.op === "focus") console.log(`${opLabel(op.op)} ${op.nodeId ? `${op.nodeId} ` : ""}${op.currentFocus}`);
    else if (op.op === "call_tool") console.log(`${opLabel(op.op)} ${op.tool} ${JSON.stringify(op.args)}`);
    else if (op.op === "spawn_worker") console.log(`${opLabel(op.op)} ${op.id} focus=${op.focusNodeId ?? "auto"} ${op.objective}`);
    else console.log(`${opLabel(op.op)} ${op.answer}`);
  }
}

async function readPipedInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { maxIterations: 5, showPrompt: false, fullFrame: false, compare: false, showGraph: false };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--input" || arg === "-i") options.input = value(args, ++index, arg);
    else if (arg === "--max-iterations") options.maxIterations = Number(value(args, ++index, arg));
    else if (arg === "--prompt") options.showPrompt = true;
    else if (arg === "--no-prompt") options.showPrompt = false;
    else if (arg === "--full") options.fullFrame = true;
    else if (arg === "--compare") options.compare = true;
    else if (arg === "--graph") options.showGraph = true;
    else if (arg === "--help" || arg === "-h") help();
    else positional.push(arg);
  }

  if (!options.input && positional.length) options.input = positional.join(" ");
  if (!Number.isInteger(options.maxIterations) || options.maxIterations < 1) throw new Error("--max-iterations must be a positive integer.");
  return options;
}

function header(): void {
  console.log(color.bold(color.magenta("StateWeave CLI")) + color.dim(" · GraphFrame → GraphOps → StateGraph"));
  console.log(color.dim("Type one task. Short-term graph memory stays active. Commands: /prompt, /compare, /graph, /reset, /full, /compact, /help, /exit"));
}

function printHelp(): void {
  console.log(`
${color.bold("Usage")}
  pnpm cli
  pnpm cli "Find why login fails after token refresh. Do not rewrite the auth system."
  pnpm cli --input "Find why login fails after token refresh." --prompt --compare --graph

${color.bold("Commands")}
  /prompt   toggle exact provider prompt
  /compare  toggle traditional messages comparison
  /graph    toggle Mermaid graph output
  /reset    clear short-term graph memory
  /full     show full GraphFrame JSON
  /compact  show compact graph view
  /exit     quit
`);
}

function help(): never {
  printHelp();
  process.exit(0);
}

function value(args: string[], index: number, flag: string): string {
  const found = args[index];
  if (!found) throw new Error(`${flag} requires a value.`);
  return found;
}

function section(title: string, tone: keyof typeof palette): void {
  console.log(`\n${palette[tone]("━━ ")}${color.bold(palette[tone](title))}${palette[tone](" ━━")}`);
}

function label(text: string): string {
  return color.gray(`${text.padEnd(11)}:`);
}

function opLabel(text: string): string {
  return color.yellow(text.padEnd(11));
}

function line(text: string, tone: keyof typeof palette): void {
  console.log(palette[tone](text));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

