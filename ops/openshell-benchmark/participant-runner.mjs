import { cp, lstat, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import { StateWeaveAgent } from "../../dist/agent/stateweaveAgent.js";
import { AgenticBaseline } from "../../dist/evals/agenticBaseline.js";
import { oneShotSdkBuildPrompt } from "../../dist/evals/oneShotSdkBenchmark.js";
import { AnthropicModel } from "../../dist/llm/anthropicModel.js";
import { estimateStateWeaveTokens } from "../../dist/llm/tokenizer.js";
import { createFileSystemTools } from "../../dist/tools/fileSystemTools.js";
import { runSandboxShell } from "./sandbox-shell.mjs";
const workspace = "/sandbox/workspace";
const outputDir = "/sandbox/output";
const payloadRoot = "/sandbox/benchmark/payload";
const mode = process.env.PARTICIPANT_MODE;
if (mode !== "graph" && mode !== "transcript") throw new Error("PARTICIPANT_MODE must be graph or transcript.");
const maxIterations = Number(process.env.PARTICIPANT_MAX_ITERATIONS ?? "300");
if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 3_000) throw new Error("PARTICIPANT_MAX_ITERATIONS must be an integer from 1 to 3000.");
delete process.env.PARTICIPANT_MODE;
delete process.env.PARTICIPANT_MAX_ITERATIONS;

if (typeof process.getuid === "function" && process.getuid() === 0) throw new Error("Benchmark participant must not run as root.");
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "unused") throw new Error("A real model credential reached the sandbox.");

const abortController = new AbortController();
let progressWriteQueue = Promise.resolve();
for (const signalName of ["SIGTERM", "SIGINT"]) process.once(signalName, () => abortController.abort(new Error(`Received ${signalName}`)));

await mkdir(outputDir, { recursive: true });
await prepareWorkspace();

const model = new AnthropicModel({
  apiKey: "unused",
  baseUrl: "https://inference.local",
  model: "openshell-managed",
  maxTokens: 4096,
  temperature: 0,
  timeoutMs: 300_000
});
let workspaceMutationGeneration = 0;
const fileTools = createFileSystemTools({ rootDir: workspace, timeoutMs: 60_000, maxOutputBytes: 64_000 })
  .filter((tool) => tool.name !== "bash_command")
  .map((tool) => tool.name === "write_file" || tool.name === "edit_file"
    ? {
        ...tool,
        async execute(args) {
          const result = await tool.execute(args);
          if (!result || typeof result !== "object" || result.ok !== false) workspaceMutationGeneration += 1;
          return result;
        }
      }
    : tool);
const tools = [
  ...fileTools,
  createOpenShellTool(abortController.signal, () => workspaceMutationGeneration)
];
const providerSystem = [
  "You are a persistent senior coding agent inside one private NVIDIA OpenShell workspace.",
  "Complete the supplied task autonomously using the available file and shell tools.",
  "Use write_file and edit_file for project mutations so completion evidence is tracked; use bash_command for tests, builds, and bounded inspection, not for creating project files.",
  "Treat filesystem, process, network, and inference policy denials as hard boundaries.",
  "Operate only inside /sandbox/workspace, inspect current files before changing them, and verify the result before finishing.",
  "Never seek credentials, host resources, another workspace, or information about any surrounding evaluation.",
  "Converge deliberately: inspect a failed check, fix its root cause through the file tools, and never rerun an unchanged check repeatedly."
].join(" ");
const systemPrompt = "Build the requested project completely in the supplied workspace. Aim to finish within 250 model turns. Use file tools for implementation, diagnose check failures instead of cycling, and once the deliverables and checks are genuinely complete, return a concise factual summary immediately.";
const startedAt = Date.now();

try {
  const outcome = mode === "graph"
    ? await runGraphParticipant({ model, tools, providerSystem, systemPrompt, maxIterations, signal: abortController.signal })
    : await runTranscriptParticipant({ model, tools, providerSystem, systemPrompt, maxIterations, signal: abortController.signal });
  await removeDependencyLink();
  const report = { ok: true, mode, maxIterations, finalAnswer: outcome.finalAnswer, metrics: { ...outcome.metrics, durationMs: Date.now() - startedAt } };
  await writeJson(`${outputDir}/result.json`, report);
  if (outcome.frame) await writeJson(`${outputDir}/frame.json`, outcome.frame);
  if (outcome.messages) await writeJson(`${outputDir}/messages.json`, outcome.messages);
  emitProgress({ iteration: outcome.metrics.modelCalls, phase: "completed", modelCalls: outcome.metrics.modelCalls, toolCalls: outcome.metrics.toolCalls, detail: "Participant completed the project and returned a final answer." });
  console.log(`RESULT ${JSON.stringify(report)}`);
} catch (error) {
  await removeDependencyLink().catch(() => undefined);
  const stopped = abortController.signal.aborted;
  const failureTrace = Array.isArray(error?.trace) ? error.trace : [];
  const failureMetrics = failureTrace.length
    ? {
        modelCalls: failureTrace.length,
        toolCalls: failureTrace.reduce((sum, step) => sum + step.parsedOps.filter((op) => op.op === "call_tool").length, 0),
        latestContextTokens: failureTrace.at(-1)?.tokenEstimate?.estimatedTokens ?? 0,
        totalInputTokens: failureTrace.reduce((sum, step) => sum + (step.tokenEstimate?.estimatedTokens ?? 0), 0),
        outputTokens: failureTrace.reduce((sum, step) => sum + estimateStateWeaveTokens(step.rawModelOutput ?? "").estimatedTokens, 0),
        durationMs: Date.now() - startedAt
      }
    : { modelCalls: 0, toolCalls: 0, latestContextTokens: 0, totalInputTokens: 0, outputTokens: 0, durationMs: Date.now() - startedAt };
  const report = { ok: false, mode, maxIterations, stopped, error: error instanceof Error ? error.message : String(error), metrics: failureMetrics };
  await writeJson(`${outputDir}/result.json`, report);
  if (error?.frame) await writeJson(`${outputDir}/frame.failed.json`, error.frame);
  emitProgress({ iteration: 0, phase: stopped ? "stopped" : "failed", modelCalls: 0, toolCalls: 0, detail: report.error });
  console.log(`RESULT ${JSON.stringify(report)}`);
  process.exitCode = stopped ? 130 : 1;
}

async function runGraphParticipant({ model, tools, providerSystem, systemPrompt, maxIterations, signal }) {
  const agent = new StateWeaveAgent({
    model,
    tools,
    maxIterations,
    maxPromptTokens: 250_000,
    systemPrompt,
    nodeTypes: ["task", "file", "symbol", "decision", "constraint", "test_result"],
    traceMode: "compact",
    blindIdentity: true,
    providerSystem
  });
  let result;
  let modelCalls = 0;
  let toolCalls = 0;
  let providerInputTokens = 0;
  let providerOutputTokens = 0;
  for await (const event of agent.stream(oneShotSdkBuildPrompt, { signal })) {
    if (event.type === "frame" && event.phase === "before") {
      modelCalls = Math.max(modelCalls, event.step);
      emitProgress({ iteration: event.step, phase: "model", modelCalls, toolCalls, totalInputTokens: providerInputTokens, outputTokens: providerOutputTokens, detail: `Model iteration ${event.step}` });
    }
    if (event.type === "model_metadata") {
      const usage = event.metadata?.usage;
      if (usage && typeof usage === "object") {
        if (event.metadata.event === "message_start") providerInputTokens += anthropicInputTokens(usage);
        if (event.metadata.event === "message_delta" && typeof usage.output_tokens === "number") providerOutputTokens += usage.output_tokens;
      }
    }
    if (event.type === "ops") {
      toolCalls += event.ops.filter((op) => op.op === "call_tool").length;
      const tool = event.ops.find((op) => op.op === "call_tool");
      if (tool?.op === "call_tool") emitProgress({ iteration: event.step, phase: "tool", modelCalls, toolCalls, totalInputTokens: providerInputTokens, outputTokens: providerOutputTokens, detail: `Running ${tool.tool}` });
    }
    if (event.type === "error") emitProgress({ iteration: event.step, phase: "retrying", modelCalls, toolCalls, totalInputTokens: providerInputTokens, outputTokens: providerOutputTokens, detail: event.message.slice(0, 400) });
    if (event.type === "frame" && event.phase === "after" && event.step % 50 === 0) {
      await writeJson(`${outputDir}/frame.checkpoint.json`, event.frame);
      await writeJson(`${outputDir}/metrics.checkpoint.json`, { modelCalls, toolCalls, totalInputTokens: providerInputTokens, outputTokens: providerOutputTokens, updatedAt: new Date().toISOString() });
    }
    if (event.type === "final") result = event.result;
  }
  if (!result) throw new Error("Graph-memory participant ended without a final result.");
  const latestContextTokens = result.trace.at(-1)?.tokenEstimate.estimatedTokens ?? 0;
  const totalInputTokens = result.trace.reduce((sum, step) => sum + step.tokenEstimate.estimatedTokens, 0);
  const outputTokens = result.trace.reduce((sum, step) => sum + estimateStateWeaveTokens(step.rawModelOutput).estimatedTokens, 0);
  return { finalAnswer: result.finalAnswer, frame: result.frame, metrics: { modelCalls: result.metadata.stepCount, toolCalls, latestContextTokens, totalInputTokens: providerInputTokens || totalInputTokens, outputTokens: providerOutputTokens || outputTokens } };
}

async function runTranscriptParticipant({ model, tools, providerSystem, systemPrompt, maxIterations, signal }) {
  const agent = new AgenticBaseline({
    model,
    tools,
    systemPrompt,
    maxIterations,
    maxContextTokens: 250_000,
    compaction: { thresholdTokens: 250_000, retainMessages: 12 },
    providerSystem,
    enforceCompletionEvidence: false
  });
  const result = await agent.run(oneShotSdkBuildPrompt, {
    signal,
    onProgress(progress) {
      emitProgress({ iteration: progress.iteration, phase: progress.phase, modelCalls: progress.modelCalls, toolCalls: progress.toolCalls, detail: progress.detail });
    }
  });
  if (!result.completed) throw new Error(result.error ?? result.answer);
  return {
    finalAnswer: result.answer,
    messages: agent.getMessages(),
    metrics: { modelCalls: result.modelCalls, toolCalls: result.toolCalls, latestContextTokens: result.contextTokens, totalInputTokens: result.totalInputTokens, outputTokens: result.outputTokens }
  };
}

function createOpenShellTool(signal, mutationGeneration) {
  const repeatedCommands = new Map();
  const schema = z.object({ command: z.string().min(1).max(50_000), timeout_seconds: z.coerce.number().int().min(1).max(180).optional() });
  return {
    name: "bash_command",
    description: "Run a full shell command inside the isolated OpenShell workspace for npm scripts, tests, builds, and bounded inspection. Use write_file/edit_file—not shell redirection—for project mutations so completion evidence is tracked. The command starts in /sandbox/workspace; all descendants are terminated when the call ends or times out. Args: command, optional timeout_seconds (1-180).",
    schema,
    async execute(args) {
      const parsed = schema.parse(args);
      const normalizedCommand = parsed.command.trim().replace(/\s+/g, " ");
      const commandKey = `${mutationGeneration()}:${normalizedCommand}`;
      const attempts = (repeatedCommands.get(commandKey) ?? 0) + 1;
      repeatedCommands.set(commandKey, attempts);
      if (attempts > 2) {
        return {
          ok: false,
          exitCode: 2,
          stdout: "",
          stderr: "convergence_guard: This unchanged command already ran twice without a successful write_file/edit_file mutation. Inspect the failure, fix the root cause through the file tools, then run the check again.",
          timedOut: false,
          aborted: false
        };
      }
      return await runSandboxShell({
        command: parsed.command,
        cwd: workspace,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: `${workspace}/.home`,
          TMPDIR: "/tmp",
          CI: "1",
          NO_COLOR: "1",
          npm_config_cache: `${workspace}/.npm-cache`
        },
        timeoutMs: (parsed.timeout_seconds ?? 120) * 1000,
        signal
      });
    }
  };
}

async function prepareWorkspace() {
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  await cp(`${payloadRoot}/workspace-seed`, workspace, { recursive: true });
  await mkdir(`${workspace}/.home`, { recursive: true });
  await symlink(`${payloadRoot}/deps/node_modules`, `${workspace}/node_modules`, "dir");
}

async function removeDependencyLink() {
  const target = `${workspace}/node_modules`;
  const info = await lstat(target).catch(() => undefined);
  if (!info?.isSymbolicLink()) return;
  const link = await readlink(target);
  if (link === `${payloadRoot}/deps/node_modules`) await rm(target);
}

function emitProgress(progress) {
  const event = { ...progress, updatedAt: new Date().toISOString() };
  console.log(`PROGRESS ${JSON.stringify(event)}`);
  progressWriteQueue = progressWriteQueue.catch(() => undefined).then(() => writeJson(`${outputDir}/progress.json`, event));
}

async function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true });
  await import("node:fs/promises").then(({ rename }) => rename(temporary, filePath));
}

function anthropicInputTokens(usage) {
  return [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
    .filter((value) => typeof value === "number")
    .reduce((sum, value) => sum + value, 0);
}

function truncate(value) {
  const text = String(value ?? "");
  return text.length <= 64_000 ? text : `${text.slice(0, 64_000)}\n...[truncated]`;
}
