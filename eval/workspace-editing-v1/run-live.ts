import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkspaceEditingCases, type WorkspaceEditingCase } from "./grader.mjs";
import {
  assertIsolatedWorkspaces,
  assertMatchedEndpoint,
  captureEpisode,
  createEvaluationRoot,
  materializeWorkspace,
  runGraphEpisode,
  runMessagesEpisode,
  type AuditedEpisode,
  type GraphEpisodeResult,
  type MessagesEpisodeResult
} from "./runner.js";
import { LiveBudget, ZaiGraphModel, ZaiMessagesModel, zaiConfigFromEnv } from "./live-provider.js";

type FrozenManifest = {
  protocolId: string;
  implementationRevision: string;
  executionAck: string;
  approvedAt: string;
  expectedEndpoint: { provider: "zai"; hostPath: string; model: "glm-5.3" };
  limits: {
    maxIterationsPerTurn: number;
    maxPromptTokens: number;
    maxOutputTokens: number;
    timeoutMs: number;
    retries: 0;
    maxProviderCalls: number;
    maxReservedTokens: number;
    repetitions: 1;
  };
  armOrder: "alternating-by-case";
  stoppingRule: string;
  billingMode: "zai-coding-plan";
  portalTarget: "development-only";
  files: Record<string, string>;
};

type ArmEvidence = {
  audited: AuditedEpisode<GraphEpisodeResult> | AuditedEpisode<MessagesEpisodeResult>;
  workspace: Record<string, string>;
};

type CaseEvidence = {
  caseId: string;
  title: string;
  order: Array<"graph" | "messages">;
  graph?: ArmEvidence;
  messages?: ArmEvidence;
  endpointMatched: boolean | null;
  endpointError?: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const manifestPath = path.join(here, "frozen-live-manifest.json");
const outputPath = requiredArgument("--output");
const sourceRevision = requiredEnvironment("STATEWEAVE_EVAL_SOURCE_REVISION");
const executionAck = requiredEnvironment("STATEWEAVE_EVAL_EXECUTION_ACK");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as FrozenManifest;
if (executionAck !== manifest.executionAck) throw new Error("Live execution acknowledgement does not match the frozen manifest.");
if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error("STATEWEAVE_EVAL_SOURCE_REVISION must be a full Git revision.");
await verifyFrozenFiles(manifest);

const config = zaiConfigFromEnv();
const endpoint = new URL(config.baseUrl);
const hostPath = `${endpoint.host}${endpoint.pathname.replace(/\/$/, "")}`;
if (hostPath !== manifest.expectedEndpoint.hostPath || config.model !== manifest.expectedEndpoint.model) {
  throw new Error(`Runtime endpoint mismatch: expected ${manifest.expectedEndpoint.hostPath}/${manifest.expectedEndpoint.model}, received ${hostPath}/${config.model}.`);
}
for (const [name, actual, expected] of [
  ["maxOutputTokens", config.maxOutputTokens, manifest.limits.maxOutputTokens],
  ["timeoutMs", config.timeoutMs, manifest.limits.timeoutMs],
  ["maxProviderCalls", config.maxProviderCalls, manifest.limits.maxProviderCalls],
  ["maxReservedTokens", config.maxReservedTokens, manifest.limits.maxReservedTokens]
] as const) {
  if (actual !== expected) throw new Error(`Runtime ${name} does not match the frozen manifest: ${actual} versus ${expected}.`);
}

const spec = getWorkspaceEditingCases();
if (spec.cases.length !== 5) throw new Error(`Frozen run requires exactly five cases, received ${spec.cases.length}.`);
const budget = new LiveBudget(config);
const graphModel = new ZaiGraphModel(config, budget);
const messagesModel = new ZaiMessagesModel(config, budget);
const evaluationRoot = await createEvaluationRoot();
const startedAt = new Date().toISOString();
const runId = `${manifest.protocolId}-${startedAt.replace(/[-:.]/g, "").replace("Z", "Z")}`;
const caseEvidence: CaseEvidence[] = [];
let stopReason: string | null = null;

const result = {
  schemaVersion: 1,
  runId,
  protocolId: manifest.protocolId,
  status: "running" as "running" | "completed" | "stopped",
  startedAt,
  completedAt: null as string | null,
  sourceRevision,
  source: spec.source,
  manifest,
  runtime: {
    provider: manifest.expectedEndpoint.provider,
    endpoint: manifest.expectedEndpoint.hostPath,
    model: config.model,
    billingMode: manifest.billingMode,
    incrementalDollarEstimate: null,
    retryCount: 0
  },
  evaluationRoot: path.basename(evaluationRoot),
  budget: budget.snapshot(),
  stopReason: null as string | null,
  cases: caseEvidence,
  aggregate: aggregate(caseEvidence)
};
const outputLock = await acquireOutputLock(outputPath, sourceRevision);
let unexpectedError: unknown;

try {
  await persist();

for (const [caseIndex, item] of spec.cases.entries()) {
  if (stopReason) break;
  const order: Array<"graph" | "messages"> = caseIndex % 2 === 0 ? ["graph", "messages"] : ["messages", "graph"];
  const record: CaseEvidence = { caseId: item.id, title: item.title, order, endpointMatched: null };
  caseEvidence.push(record);

  const graphDir = path.join(evaluationRoot, `${item.id.toLowerCase()}-graph`);
  const messagesDir = path.join(evaluationRoot, `${item.id.toLowerCase()}-messages`);
  await materializeWorkspace(item, graphDir, evaluationRoot);
  await materializeWorkspace(item, messagesDir, evaluationRoot);
  await assertIsolatedWorkspaces(graphDir, messagesDir);

  for (const arm of order) {
    const workspaceDir = arm === "graph" ? graphDir : messagesDir;
    const audited = arm === "graph"
      ? await captureEpisode("graph", item.id, () => runGraphEpisode({
        item,
        commonInstructions: spec.commonInstructions,
        workspaceDir,
        model: graphModel,
        maxIterationsPerTurn: manifest.limits.maxIterationsPerTurn,
        maxPromptTokens: manifest.limits.maxPromptTokens
      }))
      : await captureEpisode("messages", item.id, () => runMessagesEpisode({
        item,
        commonInstructions: spec.commonInstructions,
        workspaceDir,
        model: messagesModel,
        maxIterationsPerTurn: manifest.limits.maxIterationsPerTurn,
        maxPromptTokens: manifest.limits.maxPromptTokens
      }));
    const evidence: ArmEvidence = { audited, workspace: await snapshotWorkspace(workspaceDir) };
    if (arm === "graph") record.graph = evidence;
    else record.messages = evidence;
    if (audited.status === "operational_failure" && audited.failure.stage === "model") {
      stopReason = `Provider/model failure in ${item.id}/${arm}: ${audited.failure.message}`;
    }
    result.budget = budget.snapshot();
    result.stopReason = stopReason;
    result.aggregate = aggregate(caseEvidence);
    await persist();
    if (stopReason) break;
  }

  const graph = completedGraph(record.graph);
  const messages = completedMessages(record.messages);
  if (graph && messages) {
    try {
      assertMatchedEndpoint(graph, messages, manifest.expectedEndpoint);
      record.endpointMatched = true;
    } catch (error) {
      record.endpointMatched = false;
      record.endpointError = errorMessage(error);
      stopReason = `Endpoint mismatch in ${item.id}: ${record.endpointError}`;
    }
  }
  result.stopReason = stopReason;
  result.aggregate = aggregate(caseEvidence);
  await persist();
}

  result.status = stopReason ? "stopped" : "completed";
  result.completedAt = new Date().toISOString();
  result.stopReason = stopReason;
  result.budget = budget.snapshot();
  result.aggregate = aggregate(caseEvidence);
  await persist();
} catch (error) {
  unexpectedError = error;
  result.status = "stopped";
  result.completedAt = new Date().toISOString();
  result.stopReason = `Executor failure: ${errorMessage(error)}`;
  result.budget = budget.snapshot();
  result.aggregate = aggregate(caseEvidence);
  await persist().catch(() => undefined);
} finally {
  await finalizeOutputLock(outputLock, unexpectedError ? "failed" : "complete");
}
if (unexpectedError) throw unexpectedError;

async function persist(): Promise<void> {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (serialized.includes(config.apiKey)) throw new Error("Refusing to persist output containing the provider credential.");
  const temporary = `${outputPath}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, outputPath);
  const directory = await open(path.dirname(outputPath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function acquireOutputLock(target: string, revision: string): Promise<{ handle: FileHandle; path: string }> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await stat(target);
    throw new Error(`Live result output already exists and will not be overwritten: ${target}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const lockPath = `${target}.lock`;
  const handle = await open(lockPath, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify({ sourceRevision: revision, pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
  await handle.sync();
  return { handle, path: lockPath };
}

async function finalizeOutputLock(lock: { handle: FileHandle; path: string }, status: "complete" | "failed"): Promise<void> {
  await lock.handle.close();
  await rename(lock.path, `${outputPath}.${status}`);
}

async function verifyFrozenFiles(value: FrozenManifest): Promise<void> {
  for (const [relativePath, expectedHash] of Object.entries(value.files)) {
    const filePath = path.resolve(repositoryRoot, relativePath);
    if (!filePath.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error(`Frozen file escapes repository root: ${relativePath}`);
    const actualHash = createHash("sha256").update(await readFile(filePath)).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Frozen file hash mismatch for ${relativePath}: ${actualHash} versus ${expectedHash}.`);
  }
}

async function snapshotWorkspace(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  await walk(root, "", output);
  return output;
}

async function walk(root: string, relative: string, output: Record<string, string>): Promise<void> {
  const directory = path.join(root, relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = path.posix.join(relative.replaceAll(path.sep, "/"), entry.name);
    const child = path.join(root, childRelative);
    if (entry.isDirectory()) await walk(root, childRelative, output);
    else if (entry.isFile()) {
      const fileStat = await stat(child);
      if (fileStat.size > 1_000_000) throw new Error(`Workspace evidence file is unexpectedly large: ${childRelative}`);
      output[childRelative] = await readFile(child, "utf8");
    } else {
      throw new Error(`Workspace evidence contains unsupported entry: ${childRelative}`);
    }
  }
}

function completed(value: ArmEvidence | undefined): GraphEpisodeResult | MessagesEpisodeResult | undefined {
  return value?.audited.status === "completed" ? value.audited.result : undefined;
}

function completedGraph(value: ArmEvidence | undefined): GraphEpisodeResult | undefined {
  const result = completed(value);
  return result?.arm === "graph" ? result : undefined;
}

function completedMessages(value: ArmEvidence | undefined): MessagesEpisodeResult | undefined {
  const result = completed(value);
  return result?.arm === "messages" ? result : undefined;
}

function aggregate(cases: CaseEvidence[]): Record<string, unknown> {
  return {
    graph: armAggregate(cases, "graph"),
    messages: armAggregate(cases, "messages"),
    endpointMatchedPairs: cases.filter((item) => item.endpointMatched === true).length,
    completePairs: cases.filter((item) => completed(item.graph) && completed(item.messages)).length,
    attemptedCases: cases.length,
    plannedCases: 5,
    interpretation: "One descriptive paired pass over five approved synthetic regression-derived cases; no statistical or superiority claim."
  };
}

function armAggregate(cases: CaseEvidence[], arm: "graph" | "messages"): Record<string, number> {
  const records = cases.map((item) => item[arm]).filter((item): item is ArmEvidence => Boolean(item));
  const completedRecords = records.filter((item) => item.audited.status === "completed");
  return {
    attempted: records.length,
    completed: completedRecords.length,
    taskPasses: completedRecords.filter((item) => item.audited.status === "completed" && item.audited.result.grade.grade.taskOutcome).length,
    operationalFailures: records.filter((item) => item.audited.status === "operational_failure").length,
    totalModelCalls: completedRecords.reduce((sum, item) => sum + modelCallCount(item.audited), 0),
    totalDurationMs: completedRecords.reduce((sum, item) => sum + (item.audited.status === "completed" ? item.audited.result.durationMs : 0), 0)
  };
}

function modelCallCount(audited: ArmEvidence["audited"]): number {
  if (audited.status !== "completed") return 0;
  return audited.result.arm === "graph" ? audited.result.modelCalls.length : audited.result.calls.length;
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required.`);
  return path.resolve(value);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
