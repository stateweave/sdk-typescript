import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { oneShotPromptStats, oneShotSdkBuildPrompt, sdkBuildBenchmarkVersion } from "../../dist/evals/oneShotSdkBenchmark.js";

const controlDir = path.resolve(process.env.BENCHMARK_CONTROL_DIR ?? "/var/lib/docker/volumes/stateweave-web-development-zrzoej_stateweave-web-data/_data/sdk-build-benchmark");
const payloadDir = path.resolve(process.env.BENCHMARK_PAYLOAD_DIR ?? "/root/stateweave-sdk-benchmark/payload");
const policyPath = path.join(payloadDir, "runtime", "ops", "openshell-benchmark", "policy.yaml");
const statePath = path.join(controlDir, "state.json");
const startRequestPath = path.join(controlDir, "requests", "start.json");
const processingRequestPath = path.join(controlDir, "requests", "start.processing.json");
const stopRequestPath = path.join(controlDir, "requests", "stop.json");
const retryRequestPath = path.join(controlDir, "requests", "retry-failed.json");
const retryProcessingPath = path.join(controlDir, "requests", "retry-failed.processing.json");
const promptSha256 = createHash("sha256").update(oneShotSdkBuildPrompt).digest("hex");
const promptWords = oneShotPromptStats().words;
const workerVersion = "sdk-build-openshell-v1";
const sandboxImage = "ghcr.io/nvidia/openshell-community/sandboxes/base@sha256:aeef1c63f00e2913ea002ccb3aaf925f338b5c5d70e63576f0d95c16a138044e";
let state;
let stateWriteQueue = Promise.resolve();
let activeRun;
let currentExec;
let stopping = false;

await mkdir(path.join(controlDir, "requests"), { recursive: true });
await mkdir(path.join(controlDir, "runs"), { recursive: true });
await assertPayload();
state = await readJson(statePath);
if (!state) state = readyState("OpenShell worker is ready. No benchmark has run.");
else if (["queued", "preparing", "running", "stopping"].includes(state.status)) {
  state.status = "failed";
  state.message = "Worker restarted during an active benchmark. Sandboxes and artifacts were preserved for operator inspection; the run was not resumed silently.";
  state.completedAt = new Date().toISOString();
}
await saveState();

const heartbeat = setInterval(() => {
  state.workerHeartbeatAt = new Date().toISOString();
  void saveState();
}, 5_000);
heartbeat.unref();

for (const signalName of ["SIGTERM", "SIGINT"]) {
  process.once(signalName, async () => {
    stopping = true;
    clearInterval(heartbeat);
    if (currentExec) currentExec.kill("SIGTERM");
    await saveState().catch(() => undefined);
    process.exit(0);
  });
}

while (!stopping) {
  await handleStopRequest();
  if (!activeRun && await exists(retryRequestPath)) {
    await rm(retryProcessingPath, { force: true });
    await rename(retryRequestPath, retryProcessingPath).catch(() => undefined);
    if (await exists(retryProcessingPath)) {
      activeRun = processRetry().catch(async (error) => {
        state.status = "failed";
        state.completedAt = new Date().toISOString();
        await saveState(`Candidate retry worker failed: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(async () => {
        activeRun = undefined;
        currentExec = undefined;
        await rm(retryProcessingPath, { force: true });
        await rm(stopRequestPath, { force: true });
      });
    }
  }
  if (!activeRun && await exists(startRequestPath)) {
    await rm(processingRequestPath, { force: true });
    await rename(startRequestPath, processingRequestPath).catch(() => undefined);
    if (await exists(processingRequestPath)) {
      activeRun = processRun().catch(async (error) => {
        state.status = "failed";
        state.completedAt = new Date().toISOString();
        await saveState(`Benchmark worker failed: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(async () => {
        activeRun = undefined;
        currentExec = undefined;
        await rm(processingRequestPath, { force: true });
        await rm(stopRequestPath, { force: true });
      });
    }
  }
  await sleep(1_000);
}

async function processRun() {
  const request = await readJson(processingRequestPath);
  if (!request || state.status !== "ready") return;
  const runId = `sdk_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
  const armOrder = Math.random() < 0.5 ? ["graph", "transcript"] : ["transcript", "graph"];
  const labelGraphFirst = Math.random() < 0.5;
  const labels = labelGraphFirst ? { a: "graph", b: "transcript" } : { a: "transcript", b: "graph" };
  const neutralNames = Math.random() < 0.5 ? ["harbor", "meadow"] : ["meadow", "harbor"];
  const sandboxByArm = { [armOrder[0]]: `sdkb-${runId.slice(-8)}-${neutralNames[0]}`, [armOrder[1]]: `sdkb-${runId.slice(-8)}-${neutralNames[1]}` };
  const now = new Date().toISOString();
  state = {
    version: sdkBuildBenchmarkVersion,
    workerVersion,
    status: "queued",
    message: "Benchmark accepted. Preparing two isolated OpenShell workspaces.",
    promptSha256,
    promptWords,
    workerHeartbeatAt: now,
    runId,
    createdAt: request.createdAt ?? now,
    startedAt: now,
    executionOrder: armOrder,
    labels,
    arms: {
      graph: { slot: armOrder.indexOf("graph") + 1, status: "waiting", sandboxName: sandboxByArm.graph, attempt: 1, maxIterations: 300, artifactKey: "graph" },
      transcript: { slot: armOrder.indexOf("transcript") + 1, status: "waiting", sandboxName: sandboxByArm.transcript, attempt: 1, maxIterations: 300, artifactKey: "transcript" }
    }
  };
  const runDir = path.join(controlDir, "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeJson(path.join(runDir, "protocol.json"), { version: sdkBuildBenchmarkVersion, workerVersion, sandboxImage, promptSha256, promptWords, executionOrder: armOrder, labels, sandboxByArm, createdAt: now });
  await saveState();

  try {
    state.status = "preparing";
    await saveState("Creating and probing isolated OpenShell sandboxes.");
    for (const arm of armOrder) {
      await prepareSandbox(arm, sandboxByArm[arm]);
      if (await stopRequested()) throw new StopRequestedError();
    }

    state.status = "running";
    await saveState("Both sandboxes passed the security probe. Running participants in randomized order.");
    for (const arm of armOrder) {
      if (await stopRequested()) throw new StopRequestedError();
      await runArm(arm, sandboxByArm[arm], runDir, { maxIterations: 300, artifactKey: arm });
    }

    state.status = "completed";
    state.completedAt = new Date().toISOString();
    const failures = Object.values(state.arms).filter((arm) => arm.status !== "completed").length;
    await saveState(failures ? `Both attempts finished; ${failures} participant${failures === 1 ? "" : "s"} failed and should be scored accordingly.` : "Both candidates finished. Blind human review is ready.");
  } catch (error) {
    const stopped = error instanceof StopRequestedError;
    if (currentExec) currentExec.kill("SIGTERM");
    await terminateSandboxRuns(Object.values(sandboxByArm));
    for (const arm of Object.values(state.arms)) {
      if (arm.status === "running" || arm.status === "preparing" || arm.status === "waiting") arm.status = stopped ? "stopped" : "failed";
    }
    state.status = stopped ? "stopped" : "failed";
    state.completedAt = new Date().toISOString();
    await saveState(stopped ? "Benchmark stopped. Sandboxes and any artifacts were preserved." : `Benchmark infrastructure failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function processRetry() {
  const request = await readJson(retryProcessingPath);
  if (!request || state.status !== "completed" || !state.runId || !state.labels) return;
  if (request.candidate !== "a" && request.candidate !== "b") throw new Error("Retry candidate must be a or b.");
  if (request.maxIterations !== 3_000) throw new Error("The retry iteration limit must be exactly 3000.");
  const runDir = path.join(controlDir, "runs", state.runId);
  if (await exists(path.join(runDir, "judgement.json"))) throw new Error("A scored benchmark cannot be retried.");
  const arm = state.labels[request.candidate];
  const armState = state.arms[arm];
  if (armState.status !== "failed") throw new Error(`Candidate ${request.candidate.toUpperCase()} is not failed.`);

  const attempt = (armState.attempt ?? 1) + 1;
  const previousArtifactKey = armState.artifactKey ?? arm;
  armState.previousAttempts = [
    ...(armState.previousAttempts ?? []),
    {
      attempt: armState.attempt ?? 1,
      maxIterations: armState.maxIterations ?? 300,
      status: armState.status,
      artifactKey: previousArtifactKey,
      completedAt: armState.completedAt,
      error: armState.error
    }
  ];
  const previousSandbox = armState.sandboxName;
  const sandboxName = `${previousSandbox ?? `sdkb-${state.runId.slice(-8)}`}-r${attempt}`;
  const artifactKey = `${arm}-attempt-${attempt}`;
  if (previousSandbox) await runCommand("openshell", ["sandbox", "delete", previousSandbox], { allowFailure: true, timeoutMs: 60_000 });

  armState.status = "preparing";
  armState.sandboxName = sandboxName;
  armState.attempt = attempt;
  armState.maxIterations = request.maxIterations;
  armState.artifactKey = artifactKey;
  armState.startedAt = undefined;
  armState.completedAt = undefined;
  armState.finalAnswer = undefined;
  armState.error = undefined;
  armState.metrics = undefined;
  armState.previewRoot = undefined;
  armState.progress = progress(0, "preparing", `Preparing candidate retry attempt ${attempt}`, 0, 0);
  state.retry = { candidate: request.candidate, attempt, maxIterations: request.maxIterations, requestedAt: request.createdAt ?? new Date().toISOString() };
  state.status = "preparing";
  state.completedAt = undefined;
  await writeJson(path.join(runDir, `retry-${attempt}.json`), { candidate: request.candidate, arm, attempt, maxIterations: request.maxIterations, previousArtifactKey, artifactKey, sandboxName, requestedAt: state.retry.requestedAt });
  await saveState(`Retrying Candidate ${request.candidate.toUpperCase()} only with a ${request.maxIterations.toLocaleString()}-iteration ceiling. Original attempt preserved.`);

  try {
    await prepareSandbox(arm, sandboxName);
    if (await stopRequested()) throw new StopRequestedError();
    state.status = "running";
    await saveState(`Candidate ${request.candidate.toUpperCase()} retry attempt ${attempt} is running with a ${request.maxIterations.toLocaleString()}-iteration ceiling.`);
    await runArm(arm, sandboxName, runDir, { maxIterations: request.maxIterations, artifactKey });
    state.status = "completed";
    state.completedAt = new Date().toISOString();
    const succeeded = armState.status === "completed";
    await saveState(succeeded
      ? `Candidate ${request.candidate.toUpperCase()} retry completed. Attempt 1 remains preserved; this retry used a ${request.maxIterations.toLocaleString()}-iteration ceiling.`
      : `Candidate ${request.candidate.toUpperCase()} retry finished with status ${armState.status}. Attempt 1 remains preserved.`);
  } catch (error) {
    const stopped = error instanceof StopRequestedError;
    if (currentExec) currentExec.kill("SIGTERM");
    await terminateSandboxRuns([sandboxName]);
    if (armState.status === "running" || armState.status === "preparing" || armState.status === "waiting") armState.status = stopped ? "stopped" : "failed";
    state.status = stopped ? "stopped" : "failed";
    state.completedAt = new Date().toISOString();
    await saveState(stopped ? "Candidate retry stopped; original and retry artifacts were preserved." : `Candidate retry infrastructure failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function prepareSandbox(arm, sandboxName) {
  const armState = state.arms[arm];
  armState.status = "preparing";
  armState.progress = progress(0, "preparing", "Creating isolated OpenShell sandbox", 0, 0);
  await saveState();
  await runCommand("openshell", ["sandbox", "delete", sandboxName], { allowFailure: true, timeoutMs: 60_000 });
  await runCommand("openshell", ["sandbox", "create", "--name", sandboxName, "--from", sandboxImage, "--cpu", "1", "--memory", "3Gi", "--policy", policyPath, "--no-tty", "--", "/bin/true"], { timeoutMs: 180_000 });
  armState.progress = progress(0, "preparing", "Uploading identical benchmark runtime", 0, 0);
  await saveState();
  await runCommand("openshell", ["sandbox", "upload", "--no-git-ignore", sandboxName, payloadDir, "/sandbox/benchmark"], { timeoutMs: 300_000 });
  armState.progress = progress(0, "preparing", "Running sandbox security probe", 0, 0);
  await saveState();
  const probe = await runCommand("openshell", ["sandbox", "exec", "-n", sandboxName, "--timeout", "30", "--workdir", "/sandbox/benchmark/payload/runtime", "--", "node", "ops/openshell-mvp/security-probe.mjs"], { timeoutMs: 60_000 });
  const report = parseLastJson(probe.stdout);
  if (!report?.passed) throw new Error(`Security probe failed for neutral workspace slot ${armState.slot}.`);
  armState.status = "waiting";
  armState.progress = progress(0, "ready", "Sandbox passed security checks", 0, 0);
  await saveState();
}

async function runArm(arm, sandboxName, runDir, { maxIterations, artifactKey }) {
  const armState = state.arms[arm];
  armState.maxIterations = maxIterations;
  armState.artifactKey = artifactKey;
  armState.status = "running";
  armState.startedAt = new Date().toISOString();
  armState.progress = progress(0, "starting", "Starting participant", 0, 0);
  await saveState(`Participant ${armState.slot} is working.`);
  const args = ["sandbox", "exec", "-n", sandboxName, "--timeout", "0", "--workdir", "/sandbox/benchmark/payload/runtime", "--", "env", `PARTICIPANT_MODE=${arm}`, `PARTICIPANT_MAX_ITERATIONS=${maxIterations}`, "node", "ops/openshell-benchmark/participant-runner.mjs"];
  const outcome = await spawnStreaming("openshell", args, (line) => {
    if (!line.startsWith("PROGRESS ")) return;
    try {
      const next = JSON.parse(line.slice("PROGRESS ".length));
      armState.progress = next;
      void saveState(`Participant ${armState.slot}: ${next.detail}`);
    } catch {}
  });

  const artifactDir = path.join(runDir, "artifacts", artifactKey);
  const workspaceDir = path.join(artifactDir, "workspace");
  const outputDir = path.join(artifactDir, "output");
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await runCommand("openshell", ["sandbox", "download", sandboxName, "/sandbox/workspace", workspaceDir], { timeoutMs: 300_000, allowFailure: true });
  await runCommand("openshell", ["sandbox", "download", sandboxName, "/sandbox/output", outputDir], { timeoutMs: 120_000, allowFailure: true });
  const report = await readJson(path.join(outputDir, "result.json"));
  armState.completedAt = new Date().toISOString();
  if (report?.ok) {
    armState.status = "completed";
    armState.finalAnswer = String(report.finalAnswer ?? "").slice(0, 20_000);
    armState.metrics = report.metrics;
    armState.previewRoot = await findPreviewRoot(workspaceDir);
    armState.progress = progress(report.metrics?.modelCalls ?? 0, "completed", "Participant completed", report.metrics?.modelCalls ?? 0, report.metrics?.toolCalls ?? 0);
  } else {
    armState.status = report?.stopped ? "stopped" : "failed";
    armState.error = String(report?.error ?? outcome.stderr ?? `Participant exited with code ${outcome.code}`).slice(0, 4_000);
    armState.metrics = report?.metrics;
    armState.previewRoot = await findPreviewRoot(workspaceDir);
    armState.progress = progress(armState.progress?.iteration ?? 0, armState.status, armState.error, armState.progress?.modelCalls ?? 0, armState.progress?.toolCalls ?? 0);
  }
  await saveState();
}

async function handleStopRequest() {
  if (!await exists(stopRequestPath) || !activeRun) return;
  state.status = "stopping";
  await saveState("Stopping the active participant and preserving artifacts.");
  if (currentExec) currentExec.kill("SIGTERM");
  await terminateSandboxRuns(Object.values(state.arms).map((arm) => arm.sandboxName).filter(Boolean));
}

async function terminateSandboxRuns(sandboxNames) {
  await Promise.all(sandboxNames.map((name) => runCommand("openshell", ["sandbox", "exec", "-n", name, "--timeout", "15", "--", "/bin/sh", "-lc", "pkill -TERM -f participant-runner.mjs || true"], { allowFailure: true, timeoutMs: 30_000 })));
}

async function spawnStreaming(command, args, onLine) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    currentExec = child;
    let stdout = "";
    let stderr = "";
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(stripAnsi(line));
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (buffer) onLine(stripAnsi(buffer));
      currentExec = undefined;
      resolve({ code: code ?? 1, signal, stdout: truncate(stdout), stderr: truncate(stderr) });
    });
  });
}

async function runCommand(command, args, options = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : undefined;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, signal, stdout: truncate(stdout), stderr: truncate(stderr) });
    });
  });
  if (result.code !== 0 && !options.allowFailure) throw new Error(`${command} ${args.slice(0, 4).join(" ")} failed (${result.code}): ${stripAnsi(result.stderr || result.stdout).slice(-2_000)}`);
  return result;
}

async function findPreviewRoot(workspaceDir) {
  for (const relative of ["dist", "build", "."]) {
    if (await exists(path.join(workspaceDir, relative, "index.html"))) return relative;
  }
  const queue = [""];
  while (queue.length) {
    const relative = queue.shift();
    if (relative.split(path.sep).length > 4 || /(^|\/)(node_modules|\.git|\.npm-cache)(\/|$)/.test(relative)) continue;
    const directory = path.join(workspaceDir, relative);
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const next = path.join(relative, entry.name);
      if (entry.isFile() && entry.name === "index.html") return relative || ".";
      if (entry.isDirectory()) queue.push(next);
    }
  }
  return undefined;
}

function readyState(message) {
  return {
    version: sdkBuildBenchmarkVersion,
    workerVersion,
    status: "ready",
    message,
    promptSha256,
    promptWords,
    workerHeartbeatAt: new Date().toISOString(),
    arms: { graph: { slot: 1, status: "waiting" }, transcript: { slot: 2, status: "waiting" } }
  };
}

function saveState(message) {
  if (message) state.message = message;
  state.workerHeartbeatAt = new Date().toISOString();
  const snapshot = structuredClone(state);
  stateWriteQueue = stateWriteQueue.catch(() => undefined).then(() => writeJson(statePath, snapshot));
  return stateWriteQueue;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  await rename(temporary, filePath);
}

async function readJson(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
}

async function assertPayload() {
  await access(path.join(payloadDir, "runtime", "dist", "index.js"));
  await access(path.join(payloadDir, "runtime", "ops", "openshell-benchmark", "participant-runner.mjs"));
  await access(path.join(payloadDir, "deps", "node_modules"));
  await access(path.join(payloadDir, "workspace-seed", "package.json"));
  await access(policyPath);
}

async function stopRequested() { return await exists(stopRequestPath); }
async function exists(filePath) { try { await stat(filePath); return true; } catch { return false; } }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function progress(iteration, phase, detail, modelCalls, toolCalls) { return { iteration, phase, modelCalls, toolCalls, detail: String(detail).slice(0, 500), updatedAt: new Date().toISOString() }; }
function truncate(value) { const text = String(value ?? ""); return text.length <= 128_000 ? text : `${text.slice(0, 128_000)}\n...[truncated]`; }
function stripAnsi(value) { return String(value).replace(/\x1b\[[0-9;]*m/g, ""); }
function parseLastJson(value) { for (const line of stripAnsi(value).trim().split(/\r?\n/).reverse()) { try { return JSON.parse(line); } catch {} } return undefined; }

class StopRequestedError extends Error {}
