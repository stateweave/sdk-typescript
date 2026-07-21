import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { causalWeaveVariantVersion, oneShotPromptStats, oneShotSdkBuildPrompt, sdkBuildBenchmarkVersion, type SdkBuildArm, type SdkBuildBenchmarkState, type SdkBuildJudgement } from "../evals/oneShotSdkBenchmark.js";

const expectedPromptSha256 = createHash("sha256").update(oneShotSdkBuildPrompt).digest("hex");
const activeStatuses = new Set(["queued", "preparing", "running", "stopping"]);
const heartbeatFreshMs = 20_000;

export class SdkBuildBenchmarkApi {
  private readonly rootDir: string;
  private readonly statePath: string;
  private readonly requestDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.statePath = path.join(this.rootDir, "state.json");
    this.requestDir = path.join(this.rootDir, "requests");
  }

  async publicState(): Promise<Record<string, unknown>> {
    const state = await this.readState();
    const stats = oneShotPromptStats();
    if (!state) return {
      version: sdkBuildBenchmarkVersion,
      status: "worker_offline",
      message: "OpenShell benchmark worker has not initialized.",
      prompt: stats,
      canStart: false,
      canStop: false,
      environments: defaultEnvironments("not_provisioned")
    };
    const workerOnline = Date.now() - Date.parse(state.workerHeartbeatAt) <= heartbeatFreshMs;
    const promptMatches = state.version === sdkBuildBenchmarkVersion && state.promptSha256 === expectedPromptSha256 && state.promptWords === stats.words;
    const ordered = state.executionOrder?.map((arm) => state.arms[arm]).sort((a, b) => a.slot - b.slot) ?? [];
    const publicState: Record<string, unknown> = {
      version: state.version,
      status: workerOnline ? state.status : "worker_offline",
      underlyingStatus: state.status,
      message: !workerOnline ? "OpenShell benchmark worker heartbeat is stale. Start is disabled." : !promptMatches ? "Worker and web prompt hashes differ. Start is disabled until the payload is rebuilt." : state.message,
      prompt: { ...stats, sha256: state.promptSha256 },
      workerOnline,
      workerHeartbeatAt: state.workerHeartbeatAt,
      runId: state.runId,
      createdAt: state.createdAt,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      canStart: workerOnline && promptMatches && state.status === "ready",
      canStop: workerOnline && activeStatuses.has(state.status),
      retry: state.retry,
      environments: state.runId
        ? ordered.map((arm) => ({ slot: arm.slot, status: arm.status, progress: arm.progress ? { ...arm.progress, detail: safeProgressDetail(arm.progress.detail) } : undefined }))
        : defaultEnvironments("not_provisioned")
    };
    const existingJudgement = state.runId ? await this.readJudgement(state.runId) : undefined;
    const originalCompleted = Boolean(state.runId && state.labels && Object.values(state.arms).every((arm) => arm.status === "completed"));
    publicState.canStartVariantC = workerOnline && promptMatches && state.status === "completed" && originalCompleted && !existingJudgement && !state.variantC;
    publicState.variantC = state.variantC ? variantCPublicState(state.variantC) : { version: causalWeaveVariantVersion, status: "not_started", previewReady: false };
    if (state.status === "completed" && state.labels && state.runId) {
      publicState.candidates = {
        a: candidatePublicState(state, state.labels.a),
        b: candidatePublicState(state, state.labels.b)
      };
      const judgement = existingJudgement;
      const failedCandidate = (["a", "b"] as const).find((candidate) => state.arms[state.labels![candidate]].status === "failed");
      publicState.canRetryFailed = workerOnline && !judgement && Boolean(failedCandidate);
      publicState.failedCandidate = failedCandidate;
      if (judgement) {
        publicState.judgement = {
          ...judgement,
          reveal: {
            a: revealName(state.labels.a),
            b: revealName(state.labels.b)
          },
          metrics: {
            a: state.arms[state.labels.a].metrics,
            b: state.arms[state.labels.b].metrics
          }
        };
      }
    }
    return publicState;
  }

  async start(): Promise<{ status: number; body: unknown }> {
    const state = await this.readState();
    if (!state) return { status: 503, body: { error: "OpenShell benchmark worker is offline." } };
    if (Date.now() - Date.parse(state.workerHeartbeatAt) > heartbeatFreshMs) return { status: 503, body: { error: "OpenShell benchmark worker heartbeat is stale." } };
    if (state.version !== sdkBuildBenchmarkVersion || state.promptSha256 !== expectedPromptSha256 || state.promptWords !== oneShotPromptStats().words) return { status: 409, body: { error: "Worker and web benchmark protocol differ. Rebuild the worker payload before starting." } };
    if (state.status !== "ready") return { status: 409, body: { error: `Benchmark cannot start while status is ${state.status}.` } };
    await mkdir(this.requestDir, { recursive: true });
    try {
      await writeFile(path.join(this.requestDir, "start.json"), `${JSON.stringify({ requestId: randomUUID(), createdAt: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: 409, body: { error: "A start request is already queued." } };
      throw error;
    }
    return { status: 202, body: { ok: true, message: "Benchmark queued. The page will update as both isolated sandboxes are prepared." } };
  }

  async startVariantC(): Promise<{ status: number; body: unknown }> {
    const state = await this.readState();
    if (!state?.runId || state.status !== "completed" || !state.labels) return { status: 409, body: { error: "A completed A/B run is required before Variant C can start." } };
    if (Date.now() - Date.parse(state.workerHeartbeatAt) > heartbeatFreshMs) return { status: 503, body: { error: "OpenShell benchmark worker heartbeat is stale." } };
    if (state.version !== sdkBuildBenchmarkVersion || state.promptSha256 !== expectedPromptSha256 || state.promptWords !== oneShotPromptStats().words) return { status: 409, body: { error: "Worker and web benchmark protocol differ. Rebuild the worker payload before starting Variant C." } };
    if (!Object.values(state.arms).every((arm) => arm.status === "completed")) return { status: 409, body: { error: "Both original candidates must be complete before Variant C starts." } };
    if (await this.readJudgement(state.runId)) return { status: 409, body: { error: "A scored benchmark cannot add Variant C." } };
    if (state.variantC) return { status: 409, body: { error: `Variant C already has status ${state.variantC.status}.` } };
    await mkdir(this.requestDir, { recursive: true });
    try {
      await writeFile(path.join(this.requestDir, "variant-c.json"), `${JSON.stringify({ requestId: randomUUID(), version: causalWeaveVariantVersion, maxIterations: 3_000, createdAt: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: 409, body: { error: "A Variant C request is already queued." } };
      throw error;
    }
    return { status: 202, body: { ok: true, message: "Variant C queued in one fresh OpenShell workspace with the unchanged prompt, model, and tools." } };
  }

  async stop(): Promise<{ status: number; body: unknown }> {
    const state = await this.readState();
    if (!state || !activeStatuses.has(state.status)) return { status: 409, body: { error: "No active benchmark can be stopped." } };
    await mkdir(this.requestDir, { recursive: true });
    await writeFile(path.join(this.requestDir, "stop.json"), `${JSON.stringify({ requestId: randomUUID(), createdAt: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return { status: 202, body: { ok: true, message: "Stop requested. Active work will be interrupted and artifacts preserved." } };
  }

  async retryFailed(input: unknown): Promise<{ status: number; body: unknown }> {
    const state = await this.readState();
    if (!state?.runId || state.status !== "completed" || !state.labels) return { status: 409, body: { error: "A completed benchmark with one failed candidate is required." } };
    if (Date.now() - Date.parse(state.workerHeartbeatAt) > heartbeatFreshMs) return { status: 503, body: { error: "OpenShell benchmark worker heartbeat is stale." } };
    if (await this.readJudgement(state.runId)) return { status: 409, body: { error: "A scored benchmark cannot be retried." } };
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const candidate = body.candidate;
    const maxIterations = Number(body.maxIterations);
    if ((candidate !== "a" && candidate !== "b") || maxIterations !== 3_000) return { status: 400, body: { error: "candidate must be a or b and maxIterations must be exactly 3000." } };
    if (state.arms[state.labels[candidate]].status !== "failed") return { status: 409, body: { error: `Candidate ${candidate.toUpperCase()} is not failed.` } };
    await mkdir(this.requestDir, { recursive: true });
    try {
      await writeFile(path.join(this.requestDir, "retry-failed.json"), `${JSON.stringify({ requestId: randomUUID(), candidate, maxIterations, createdAt: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: 409, body: { error: "A retry request is already queued." } };
      throw error;
    }
    return { status: 202, body: { ok: true, message: `Candidate ${candidate.toUpperCase()} retry queued with a 3,000-iteration ceiling.` } };
  }

  async judge(input: unknown): Promise<{ status: number; body: unknown }> {
    const state = await this.readState();
    if (!state?.runId || state.status !== "completed" || !state.labels) return { status: 409, body: { error: "Both candidate attempts must finish before scoring." } };
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const scoreA = score(body.scoreA);
    const scoreB = score(body.scoreB);
    if (scoreA === undefined || scoreB === undefined) return { status: 400, body: { error: "scoreA and scoreB must each be between 0 and 100." } };
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 5_000) : "";
    const judgement: SdkBuildJudgement = { scoreA, scoreB, notes, submittedAt: new Date().toISOString() };
    const judgementPath = path.join(this.rootDir, "runs", state.runId, "judgement.json");
    try {
      await writeFile(judgementPath, `${JSON.stringify(judgement, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: 409, body: { error: "This run has already been scored." } };
      throw error;
    }
    return { status: 200, body: { ok: true, judgement: { ...judgement, reveal: { a: revealName(state.labels.a), b: revealName(state.labels.b) } } } };
  }

  async servePreview(response: ServerResponse, candidate: "a" | "b" | "c", requestedPath: string, headOnly: boolean): Promise<void> {
    const state = await this.readState();
    if (!state?.runId || state.status !== "completed" || !state.labels) return json(response, 404, { error: "Candidate previews are not ready." });
    const candidateState = candidate === "c" ? state.variantC : state.arms[state.labels[candidate]];
    if (!candidateState) return json(response, 404, { error: "Candidate does not exist." });
    const previewRoot = candidateState.previewRoot;
    if (!previewRoot) return json(response, 404, { error: "Candidate did not produce a previewable index.html." });
    const workspaceRoot = path.join(this.rootDir, "runs", state.runId, "artifacts", candidateState.artifactKey ?? (candidate === "c" ? "causal-variant-c" : state.labels[candidate]), "workspace");
    const root = path.resolve(workspaceRoot, previewRoot);
    const relative = safeRelativePath(requestedPath || "index.html");
    let filePath = path.resolve(root, relative);
    const info = await stat(filePath).catch(() => undefined);
    if (info?.isDirectory()) filePath = path.join(filePath, "index.html");
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(filePath).catch(() => undefined);
    if (!canonicalFile || (canonicalFile !== canonicalRoot && !canonicalFile.startsWith(`${canonicalRoot}${path.sep}`))) return json(response, 404, { error: "Preview file not found." });
    const fileInfo = await lstat(canonicalFile);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return json(response, 404, { error: "Preview file not found." });
    const mime = previewContentType(canonicalFile);
    const headers: Record<string, string | number> = {
      "content-type": mime,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff"
    };
    if (mime.startsWith("text/html")) {
      const html = await readFile(canonicalFile, "utf8");
      const rewritten = rewriteHtml(html);
      headers["content-security-policy"] = previewCsp();
      headers["content-length"] = Buffer.byteLength(rewritten);
      response.writeHead(200, headers);
      response.end(headOnly ? undefined : rewritten);
      return;
    }
    headers["content-length"] = fileInfo.size;
    response.writeHead(200, headers);
    if (headOnly) {
      response.end();
      return;
    }
    createReadStream(canonicalFile).pipe(response);
  }

  private async readState(): Promise<SdkBuildBenchmarkState | undefined> {
    return readJsonFile<SdkBuildBenchmarkState>(this.statePath);
  }

  private async readJudgement(runId: string): Promise<SdkBuildJudgement | undefined> {
    return readJsonFile<SdkBuildJudgement>(path.join(this.rootDir, "runs", runId, "judgement.json"));
  }
}

function candidatePublicState(state: SdkBuildBenchmarkState, arm: SdkBuildArm): Record<string, unknown> {
  const value = state.arms[arm];
  return {
    status: value.status,
    finalAnswer: value.finalAnswer,
    error: value.error,
    previewReady: Boolean(value.previewRoot),
    attempt: value.attempt ?? 1,
    maxIterations: value.maxIterations ?? 300,
    previousAttempts: value.previousAttempts?.map((attempt) => ({ attempt: attempt.attempt, maxIterations: attempt.maxIterations, status: attempt.status }))
  };
}

function variantCPublicState(value: NonNullable<SdkBuildBenchmarkState["variantC"]>): Record<string, unknown> {
  return {
    version: value.version,
    status: value.status,
    progress: value.progress ? { ...value.progress, detail: safeProgressDetail(value.progress.detail) } : undefined,
    finalAnswer: value.finalAnswer,
    error: value.error,
    metrics: value.metrics,
    previewReady: Boolean(value.previewRoot),
    maxIterations: value.maxIterations,
    requestedAt: value.requestedAt,
    startedAt: value.startedAt,
    completedAt: value.completedAt
  };
}

function defaultEnvironments(status: string): unknown[] {
  return [1, 2].map((slot) => ({ slot, status }));
}

function revealName(arm: SdkBuildArm): string {
  return arm === "graph" ? "StateWeave graph memory" : "Native transcript memory";
}

function safeProgressDetail(value: string): string {
  return value.replace(/\b(graph|stateweave|transcript|native)\b/gi, "participant").slice(0, 500);
}

function score(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined;
  return Math.round(numeric * 10) / 10;
}

function safeRelativePath(value: string): string {
  const decoded = decodeURIComponent(value).replace(/^\/+/, "");
  if (!decoded || decoded.includes("\\") || decoded.split("/").some((part) => part === ".." || part === ".")) return "index.html";
  return decoded;
}

function rewriteHtml(html: string): string {
  return html.replace(/\b(src|href)=(['"])\/(?!\/)/gi, (_match, attribute: string, quote: string) => `${attribute}=${quote}./`);
}

function previewCsp(): string {
  return [
    "sandbox allow-scripts",
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://www.desmos.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net https://unpkg.com",
    "connect-src 'self' https://www.desmos.com https://cdn.jsdelivr.net https://unpkg.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'"
  ].join("; ");
}

function previewContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".map": "application/json; charset=utf-8"
  };
  return types[extension] ?? "application/octet-stream";
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(filePath, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
