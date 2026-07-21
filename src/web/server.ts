import "dotenv/config";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStateWeave, StateWeaveRunError, streamStateWeave } from "../agent/stateweaveRunner.js";
import { defaultSystemPrompt } from "../core/graph.js";
import type { GraphFrame, StateWeaveRunMetadata, TraceStep } from "../core/types.js";
import { createModelFromEnv } from "../llm/factory.js";
import { createDefaultTools, describeTools } from "../tools/fileSystemTools.js";
import { listChallengerScenarios, readChallengerScenario } from "../evals/challengerScenarioLibrary.js";
import { InfiniteAgentHarness } from "../evals/infiniteAgentHarness.js";
import { SdkBuildBenchmarkApi } from "./sdkBuildBenchmark.js";

type RunRequest = {
  input?: unknown;
  frame?: unknown;
  maxIterations?: unknown;
  systemPrompt?: unknown;
  nodeTypes?: unknown;
  messages?: unknown;
};

type JudgeRequest = {
  prompt?: unknown;
  gold?: unknown;
  answerA?: unknown;
  answerB?: unknown;
  categories?: unknown;
};

type JudgeVote = "a" | "b" | "both" | "neither";
type EvalRunStatus = "queued" | "running" | "paused" | "done" | "error" | "stopped";
type EvalPauseReason = "confirm" | "disagreement";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ModelMessage = { role: "user" | "assistant"; content: string };
type ComparePayload = {
  traditional: {
    messages: ModelMessage[];
    rawModelInput: string;
    output: string;
    history: ChatMessage[];
  };
  stateweave: {
    inputFrame?: GraphFrame;
    frameAfter?: GraphFrame;
    output: string;
    trace: unknown[];
    graph: unknown;
    metadata?: StateWeaveRunMetadata;
  };
};
type JudgeDecision = { id: string; vote: JudgeVote; reason: string; raw: string };
type JudgePayload = { judges: JudgeDecision[]; agreement?: JudgeVote };
type EvalCase = { prompt: string; expect: string; categories: string[] };
type EvalRecord = {
  index: number;
  prompt: string;
  expect: string;
  categories: string[];
  a: "regular" | "stateweave";
  b: "regular" | "stateweave";
  regular: string;
  stateweave: string;
  vote?: JudgeVote;
  proposedVote?: JudgeVote;
  judgedBy?: "judges" | "human";
  pauseReason?: EvalPauseReason;
  judges?: JudgeDecision[];
  error?: string;
};
type EvalRun = {
  id: string;
  suiteId: string;
  suiteTitle: string;
  status: EvalRunStatus;
  confirmJudges: boolean;
  currentIndex: number;
  cases: EvalCase[];
  records: EvalRecord[];
  stateFrame?: GraphFrame;
  regularHistory: ChatMessage[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};
type StartEvalRunRequest = { suiteId?: unknown; suiteTitle?: unknown; cases?: unknown; confirmJudges?: unknown };
type EvalVoteRequest = { vote?: unknown };
type EvalOptionsRequest = { confirmJudges?: unknown };
type WorkspaceFile = { path: string; size: number; updatedAt: string; mime: string; renderable: boolean };

const port = Number(process.env.PORT ?? 3000);
const basePath = normalizeBasePath(process.env.STATEWEAVE_WEB_BASE_PATH ?? "/");
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist-web");
const runStorePath = path.resolve(process.env.STATEWEAVE_RUN_STORE ?? ".stateweave/eval-runs.json");
const traceDir = path.resolve(process.env.STATEWEAVE_TRACE_DIR ?? ".stateweave/traces");
const challengerScenarioDir = path.resolve(process.env.STATEWEAVE_CHALLENGER_SCENARIO_DIR ?? path.join(process.cwd(), "data/challenger-scenarios"));
const model = createModelFromEnv();
const workspaceDir = path.resolve(process.env.STATEWEAVE_WORKSPACE_DIR ?? "/data/workspace");
const agentTools = createDefaultTools({ rootDir: workspaceDir });
const sdkBuildBenchmark = new SdkBuildBenchmarkApi(path.resolve(process.env.STATEWEAVE_SDK_BENCHMARK_DIR ?? "/data/sdk-build-benchmark"));

const infiniteAgentHarness = new InfiniteAgentHarness({ rootDir: path.resolve(process.env.STATEWEAVE_INFINITE_AGENT_DIR ?? "/data/infinite-agent"), model });
const infiniteAgentReady = infiniteAgentHarness.initialize();
void infiniteAgentReady.then(() => {
  const status = infiniteAgentHarness.getState().status;
  if (process.env.STATEWEAVE_INFINITE_AGENT_AUTOSTART !== "false" && (status === "idle" || status === "running")) void infiniteAgentHarness.start();
}).catch((error: unknown) => {
  console.error(`Failed to initialize infinite agent harness: ${error instanceof Error ? error.message : String(error)}`);
});

const defaultNodeTypes = ["intent", "constraint", "artifact", "decision", "fact", "hypothesis", "risk", "question", "wisdom"];
const evalRuns = new Map<string, EvalRun>();
const activeEvalRuns = new Set<string>();
const evalRunsReady = loadEvalRuns().catch((error: unknown) => {
  console.error(`Failed to load eval runs: ${error instanceof Error ? error.message : String(error)}`);
});

void evalRunsReady.then(resumeEvalRuns);

createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`StateWeave web UI listening on :${port}${basePath}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = requestUrl(request);

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { ok: true, provider: providerName(), defaultSystemPrompt, defaultNodeTypes, defaultMaxIterations: 30 });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stateweave/tools") {
    json(response, 200, { tools: describeTools(agentTools), workspaceDir });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stateweave/files") {
    json(response, 200, { files: await listWorkspaceFiles(), workspaceDir });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stateweave/files/read") {
    await readWorkspaceFile(url, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stateweave/files/reboot") {
    await rebootWorkspace(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stateweave/run") {
    await streamStateWeaveRun(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stateweave/chat") {
    await runStateWeaveTurn(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stateweave/compare") {
    await compareStateWeave(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stateweave/judge") {
    await judgeStateWeaveComparison(request, response);
    return;
  }

  if (url.pathname === "/api/stateweave/eval-runs") {
    await evalRunsReady;
    if (request.method === "GET") await listEvalRuns(response);
    else if (request.method === "POST") await startEvalRun(request, response);
    else json(response, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/sdk-build/state" && request.method === "GET") {
    json(response, 200, await sdkBuildBenchmark.publicState());
    return;
  }

  if (url.pathname === "/api/sdk-build/start" && request.method === "POST") {
    const result = await sdkBuildBenchmark.start();
    json(response, result.status, result.body);
    return;
  }

  if (url.pathname === "/api/sdk-build/variant-c/start" && request.method === "POST") {
    const result = await sdkBuildBenchmark.startVariantC();
    json(response, result.status, result.body);
    return;
  }

  if (url.pathname === "/api/sdk-build/stop" && request.method === "POST") {
    const result = await sdkBuildBenchmark.stop();
    json(response, result.status, result.body);
    return;
  }

  if (url.pathname === "/api/sdk-build/retry-failed" && request.method === "POST") {
    const result = await sdkBuildBenchmark.retryFailed(await readJson(request));
    json(response, result.status, result.body);
    return;
  }

  if (url.pathname === "/api/sdk-build/judge" && request.method === "POST") {
    const result = await sdkBuildBenchmark.judge(await readJson(request));
    json(response, result.status, result.body);
    return;
  }

  const sdkBuildPreviewMatch = url.pathname.match(/^\/api\/sdk-build\/preview\/(a|b|c|c-repaired)(?:\/(.*))?$/);
  if (sdkBuildPreviewMatch && (request.method === "GET" || request.method === "HEAD")) {
    const previewLabel = sdkBuildPreviewMatch[1];
    const candidate = previewLabel === "c-repaired" ? "c" : previewLabel as "a" | "b" | "c";
    await sdkBuildBenchmark.servePreview(response, candidate, sdkBuildPreviewMatch[2] ?? "", request.method === "HEAD", previewLabel === "c-repaired");
    return;
  }

  const infiniteAppMatch = url.pathname.match(/^\/api\/infinite-agent\/apps\/(stateweave|native)(\/.*)?$/);
  if (infiniteAppMatch) {
    json(response, 410, { error: "Infinite v6 uses private generic workspaces; participant applications are not exposed." });
    return;
  }

  if (url.pathname === "/api/infinite-agent/calibrate" && request.method === "POST") {
    await infiniteAgentReady;
    void infiniteAgentHarness.calibrate().catch((error) => console.error("Challenger calibration failed", error));
    json(response, 202, { ok: true, state: infiniteAgentHarness.getState() });
    return;
  }

  if (url.pathname === "/api/infinite-agent/start" && request.method === "POST") {
    await infiniteAgentReady;
    void infiniteAgentHarness.start();
    json(response, 200, { ok: true, state: infiniteAgentHarness.getState() });
    return;
  }

  if (url.pathname === "/api/infinite-agent/stop" && request.method === "POST") {
    await infiniteAgentReady;
    await infiniteAgentHarness.stop();
    json(response, 200, { ok: true, state: infiniteAgentHarness.getState() });
    return;
  }

  if (url.pathname === "/api/infinite-agent/state" && request.method === "GET") {
    await infiniteAgentReady;
    json(response, 200, infiniteAgentHarness.getState());
    return;
  }

  if (url.pathname === "/api/infinite-agent/graph" && request.method === "GET") {
    await infiniteAgentReady;
    json(response, 200, await infiniteAgentHarness.getGraphView());
    return;
  }

  if (url.pathname === "/api/infinite-agent/scenarios" && request.method === "GET") {
    json(response, 200, {
      purpose: "Private, human-authored long-horizon scenarios for a Challenger to send identically to both persistent participant agents and judge over time.",
      tldr: "Each Markdown file is one reviewable multi-turn test. The Challenger sees the full file; participants receive only its canonical requests.",
      scenarios: await listChallengerScenarios(challengerScenarioDir)
    });
    return;
  }

  const challengerScenarioMatch = url.pathname.match(/^\/api\/infinite-agent\/scenarios\/([^/]+)$/);
  if (challengerScenarioMatch && request.method === "GET") {
    const scenario = await readChallengerScenario(challengerScenarioDir, decodeURIComponent(challengerScenarioMatch[1]));
    if (scenario) json(response, 200, scenario);
    else json(response, 404, { error: "Challenger scenario not found." });
    return;
  }

  const infiniteAgentTurnMatch = url.pathname.match(/^\/api\/infinite-agent\/turns\/(\d+)$/);
  if (infiniteAgentTurnMatch && request.method === "GET") {
    await infiniteAgentReady;
    const turn = await infiniteAgentHarness.getTurn(Number(infiniteAgentTurnMatch[1]));
    if (turn) json(response, 200, turn);
    else json(response, 404, { error: "Turn is not available in the archive." });
    return;
  }

  const evalRunMatch = url.pathname.match(/^\/api\/stateweave\/eval-runs\/([^/]+)(?:\/([^/]+))?$/);
  if (evalRunMatch) {
    await evalRunsReady;
    await handleEvalRunRoute(request, response, decodeURIComponent(evalRunMatch[1]), evalRunMatch[2]);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(url.pathname, response, request.method === "HEAD");
}

async function streamStateWeaveRun(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as RunRequest;
  if (typeof body.input !== "string" || !body.input.trim()) {
    json(response, 400, { error: "input is required" });
    return;
  }

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no"
  });

  let finalTrace: TraceStep[] | undefined;
  let finalMetadata: StateWeaveRunMetadata | undefined;
  try {
    for await (const event of streamStateWeave(
      { model, tools: agentTools, maxIterations: safeMaxIterations(body.maxIterations), systemPrompt: safeSystemPrompt(body.systemPrompt), nodeTypes: safeNodeTypes(body.nodeTypes) },
      body.input,
      { frame: isGraphFrame(body.frame) ? body.frame : undefined }
    )) {
      if (event.type === "final") {
        finalTrace = event.result.trace;
        finalMetadata = event.result.metadata;
      }
      response.write(`${JSON.stringify(event)}\n`);
    }
    if (finalTrace) await persistTrace("stream", body.input.trim(), finalTrace, finalMetadata);
  } catch (error) {
    if (error instanceof StateWeaveRunError) await persistTrace("stream-error", body.input.trim(), error.trace, error.metadata);
    response.write(`${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error), trace: error instanceof StateWeaveRunError ? error.trace : undefined, metadata: error instanceof StateWeaveRunError ? error.metadata : undefined })}\n`);
  } finally {
    response.end();
  }
}

async function runStateWeaveTurn(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as RunRequest;
  if (typeof body.input !== "string" || !body.input.trim()) {
    json(response, 400, { error: "input is required" });
    return;
  }

  const input = body.input.trim();
  let stateweave;
  try {
    stateweave = await runStateWeave(
      { model, tools: agentTools, maxIterations: safeMaxIterations(body.maxIterations), systemPrompt: safeSystemPrompt(body.systemPrompt), nodeTypes: safeNodeTypes(body.nodeTypes) },
      input,
      { frame: isGraphFrame(body.frame) ? body.frame : undefined }
    );
  } catch (error) {
    if (error instanceof StateWeaveRunError) {
      await persistTrace("chat-error", input, error.trace, error.metadata);
      json(response, 500, { error: error.message, trace: error.trace, metadata: error.metadata });
      return;
    }
    throw error;
  }
  await persistTrace("chat", input, stateweave.trace, stateweave.metadata);

  json(response, 200, {
    stateweave: {
      inputFrame: stateweave.trace[0]?.frameBefore,
      frameAfter: stateweave.frame,
      output: stateweave.finalAnswer,
      trace: stateweave.trace,
      graph: stateweave.graph,
      metadata: stateweave.metadata
    }
  });
}

async function compareStateWeave(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as RunRequest;
  if (typeof body.input !== "string" || !body.input.trim()) {
    json(response, 400, { error: "input is required" });
    return;
  }

  const input = body.input.trim();
  const result = await compareTurn(input, isGraphFrame(body.frame) ? body.frame : undefined, safeChatMessages(body.messages), safeMaxIterations(body.maxIterations), safeSystemPrompt(body.systemPrompt), safeNodeTypes(body.nodeTypes));
  json(response, 200, result);
}

async function compareTurn(input: string, stateFrame: GraphFrame | undefined, history: ChatMessage[], maxIterations: number, systemPrompt?: string, nodeTypes?: string[]): Promise<ComparePayload> {
  const traditionalMessages = regularModelInput(history, input);
  const regularPrompt = serializeMessages(traditionalMessages);
  const [regular, stateweave] = await Promise.all([
    model.complete({ prompt: regularPrompt, mode: "text", frame: emptyFrame(input) }),
    runStateWeave({ model, tools: agentTools, maxIterations, systemPrompt, nodeTypes }, input, { frame: stateFrame })
  ]);
  await persistTrace("compare", input, stateweave.trace, stateweave.metadata);

  return {
    traditional: {
      messages: traditionalMessages,
      rawModelInput: regularPrompt,
      output: regular.text,
      history: [...history, { role: "user", content: input }, { role: "assistant", content: regular.text }]
    },
    stateweave: {
      inputFrame: stateweave.trace[0]?.frameBefore,
      frameAfter: stateweave.frame,
      output: stateweave.finalAnswer,
      trace: stateweave.trace,
      graph: stateweave.graph,
      metadata: stateweave.metadata
    }
  };
}

async function judgeStateWeaveComparison(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as JudgeRequest;
  if (typeof body.prompt !== "string" || typeof body.gold !== "string" || typeof body.answerA !== "string" || typeof body.answerB !== "string") {
    json(response, 400, { error: "prompt, gold, answerA, and answerB are required" });
    return;
  }

  const result = await judgeAnswers({
    prompt: body.prompt,
    gold: body.gold,
    answerA: body.answerA,
    answerB: body.answerB,
    categories: Array.isArray(body.categories) ? body.categories.filter((item): item is string => typeof item === "string") : []
  });
  json(response, 200, result);
}

async function judgeAnswers(args: { prompt: string; gold: string; answerA: string; answerB: string; categories: string[] }): Promise<JudgePayload> {
  const judgePrompts = shuffle([
    {
      id: "judge-alpha",
      system: "You are Judge Alpha, a strict answer verifier. Use the gold answer as truth. Grade semantic correctness only, not style or verbosity. If A and B are both correct, you must choose BOTH; if both are wrong, choose NEITHER. Return exactly WINNER: A, WINNER: B, WINNER: BOTH, or WINNER: NEITHER, then REASON: one short sentence."
    },
    {
      id: "judge-beta",
      system: "You are Judge Beta, a skeptical evaluator. Compare each answer against the gold answer and reject answers with wrong final values, contradictions, or missing required facts. Do not pick a single side when both answers are correct; choose BOTH. Return exactly WINNER: A, WINNER: B, WINNER: BOTH, or WINNER: NEITHER, then REASON: one short sentence."
    }
  ]);
  const judgePrompt = buildJudgePrompt(args);

  const judges = await Promise.all(judgePrompts.map(async (judge) => {
    const result = await model.complete({ prompt: judgePrompt, mode: "text", system: judge.system });
    const parsed = coerceJudgeVote(parseJudgeVote(result.text), args);
    return { id: judge.id, vote: parsed.vote, reason: parsed.reason, raw: result.text };
  }));
  const agreement = judges.every((judge) => judge.vote === judges[0].vote) ? judges[0].vote : undefined;
  return { judges, agreement };
}

async function listEvalRuns(response: ServerResponse): Promise<void> {
  const runs = [...evalRuns.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicEvalRun);
  json(response, 200, { runs });
}

async function startEvalRun(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as StartEvalRunRequest;
  if (typeof body.suiteId !== "string" || typeof body.suiteTitle !== "string" || !Array.isArray(body.cases)) {
    json(response, 400, { error: "suiteId, suiteTitle, and cases are required" });
    return;
  }

  const cases = safeEvalCases(body.cases);
  if (!cases.length || cases.length > 500) {
    json(response, 400, { error: "cases must contain 1-500 valid eval cases" });
    return;
  }

  const now = new Date().toISOString();
  const run: EvalRun = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    suiteId: body.suiteId,
    suiteTitle: body.suiteTitle,
    status: "queued",
    confirmJudges: body.confirmJudges === true,
    currentIndex: 0,
    cases,
    records: [],
    regularHistory: [],
    createdAt: now,
    updatedAt: now
  };

  evalRuns.set(run.id, run);
  await persistEvalRuns();
  startEvalRunWorker(run.id);
  json(response, 200, { run: publicEvalRun(run) });
}

async function handleEvalRunRoute(request: IncomingMessage, response: ServerResponse, id: string, action: string | undefined): Promise<void> {
  const run = evalRuns.get(id);
  if (!run) {
    json(response, 404, { error: "Eval run not found" });
    return;
  }

  if (request.method === "GET" && !action) {
    json(response, 200, { run: publicEvalRun(run) });
    return;
  }

  if (request.method !== "POST") {
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  if (action === "vote") {
    await voteEvalRun(request, response, run);
    return;
  }

  if (action === "options") {
    await updateEvalRunOptions(request, response, run);
    return;
  }

  if (action === "stop") {
    run.status = "stopped";
    run.updatedAt = new Date().toISOString();
    await persistEvalRuns();
    json(response, 200, { run: publicEvalRun(run) });
    return;
  }

  json(response, 404, { error: "Unknown eval run action" });
}

async function voteEvalRun(request: IncomingMessage, response: ServerResponse, run: EvalRun): Promise<void> {
  const body = (await readJson(request)) as EvalVoteRequest;
  if (!isJudgeVote(body.vote)) {
    json(response, 400, { error: "vote must be a, b, both, or neither" });
    return;
  }

  const record = run.records.at(-1);
  if (!record || record.vote || run.status !== "paused") {
    json(response, 409, { error: "Eval run is not waiting for a vote" });
    return;
  }

  record.vote = body.vote;
  record.judgedBy = record.proposedVote === body.vote ? "judges" : "human";
  delete record.pauseReason;
  run.currentIndex += 1;
  run.status = run.currentIndex >= run.cases.length ? "done" : "running";
  run.updatedAt = new Date().toISOString();
  await persistEvalRuns();
  if (run.status === "running") startEvalRunWorker(run.id);
  json(response, 200, { run: publicEvalRun(run) });
}

async function updateEvalRunOptions(request: IncomingMessage, response: ServerResponse, run: EvalRun): Promise<void> {
  const body = (await readJson(request)) as EvalOptionsRequest;
  if (typeof body.confirmJudges !== "boolean") {
    json(response, 400, { error: "confirmJudges boolean is required" });
    return;
  }

  run.confirmJudges = body.confirmJudges;
  const record = run.records.at(-1);
  if (!run.confirmJudges && run.status === "paused" && record?.proposedVote && !record.vote && record.pauseReason === "confirm") {
    record.vote = record.proposedVote;
    record.judgedBy = "judges";
    delete record.pauseReason;
    run.currentIndex += 1;
    run.status = run.currentIndex >= run.cases.length ? "done" : "running";
  }
  run.updatedAt = new Date().toISOString();
  await persistEvalRuns();
  if (run.status === "running") startEvalRunWorker(run.id);
  json(response, 200, { run: publicEvalRun(run) });
}

function startEvalRunWorker(id: string): void {
  if (activeEvalRuns.has(id)) return;
  activeEvalRuns.add(id);
  void runEvalWorker(id).finally(() => activeEvalRuns.delete(id));
}

async function runEvalWorker(id: string): Promise<void> {
  const run = evalRuns.get(id);
  if (!run || run.status === "paused" || run.status === "done" || run.status === "stopped") return;
  run.status = "running";
  run.updatedAt = new Date().toISOString();
  await persistEvalRuns();

  try {
    while (run.status === "running" && run.currentIndex < run.cases.length) {
      const testCase = run.cases[run.currentIndex];
      const result = await compareTurn(testCase.prompt, run.stateFrame, run.regularHistory, 5);
      if (currentEvalRunStatus(run) === "stopped") return;
      run.stateFrame = result.stateweave.frameAfter;
      run.regularHistory = result.traditional.history;
      const stateIsA = Math.random() < 0.5;
      const record: EvalRecord = {
        index: run.currentIndex,
        prompt: testCase.prompt,
        expect: testCase.expect,
        categories: testCase.categories,
        a: stateIsA ? "stateweave" : "regular",
        b: stateIsA ? "regular" : "stateweave",
        regular: result.traditional.output,
        stateweave: result.stateweave.output
      };

      const judge = await judgeAnswers({
        prompt: record.prompt,
        gold: record.expect,
        answerA: answerForEvalRecord(record, "a"),
        answerB: answerForEvalRecord(record, "b"),
        categories: record.categories
      });
      if (currentEvalRunStatus(run) === "stopped") return;
      record.judges = judge.judges;
      run.records.push(record);

      if (judge.agreement) {
        record.proposedVote = judge.agreement;
        if (run.confirmJudges) {
          record.pauseReason = "confirm";
          run.status = "paused";
        } else {
          record.vote = judge.agreement;
          record.judgedBy = "judges";
          run.currentIndex += 1;
        }
      } else {
        record.pauseReason = "disagreement";
        run.status = "paused";
      }

      if (run.currentIndex >= run.cases.length) run.status = "done";
      run.updatedAt = new Date().toISOString();
      await persistEvalRuns();
      if (run.status === "paused" || run.status === "done" || currentEvalRunStatus(run) === "stopped") return;
    }

    if (run.currentIndex >= run.cases.length) {
      run.status = "done";
      run.updatedAt = new Date().toISOString();
      await persistEvalRuns();
    }
  } catch (error) {
    run.status = "error";
    run.error = error instanceof Error ? error.message : String(error);
    run.updatedAt = new Date().toISOString();
    await persistEvalRuns();
  }
}

function currentEvalRunStatus(run: EvalRun): EvalRunStatus {
  return run.status;
}

function answerForEvalRecord(record: EvalRecord, slot: "a" | "b"): string {
  return record[slot] === "stateweave" ? record.stateweave : record.regular;
}

function publicEvalRun(run: EvalRun): Omit<EvalRun, "stateFrame" | "regularHistory"> {
  const { stateFrame: _stateFrame, regularHistory: _regularHistory, ...publicRun } = run;
  return publicRun;
}

async function loadEvalRuns(): Promise<void> {
  const raw = await readFile(runStorePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!raw.trim()) return;
  const parsed = JSON.parse(raw) as { runs?: EvalRun[] };
  for (const run of parsed.runs ?? []) evalRuns.set(run.id, run);
}

function resumeEvalRuns(): void {
  for (const run of evalRuns.values()) {
    if (run.status === "running" || run.status === "queued") startEvalRunWorker(run.id);
  }
}

async function persistEvalRuns(): Promise<void> {
  await mkdir(path.dirname(runStorePath), { recursive: true });
  const tmp = `${runStorePath}.tmp`;
  await writeFile(tmp, JSON.stringify({ runs: [...evalRuns.values()] }, null, 2));
  await rename(tmp, runStorePath);
}

async function listWorkspaceFiles(): Promise<WorkspaceFile[]> {
  await mkdir(workspaceDir, { recursive: true });
  const files: WorkspaceFile[] = [];
  await collectWorkspaceFiles(workspaceDir, "", files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectWorkspaceFiles(dir: string, prefix: string, files: WorkspaceFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectWorkspaceFiles(absolutePath, relativePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(absolutePath);
    const mime = fileMime(relativePath);
    files.push({ path: relativePath, size: info.size, updatedAt: info.mtime.toISOString(), mime, renderable: isRenderableMime(mime) });
  }
}

async function readWorkspaceFile(url: URL, response: ServerResponse): Promise<void> {
  const requestedPath = url.searchParams.get("path");
  if (!requestedPath) {
    json(response, 400, { error: "path is required" });
    return;
  }
  const filePath = resolveWorkspaceFilePath(requestedPath);
  const content = await readFile(filePath, "utf8");
  const info = await stat(filePath);
  const mime = fileMime(requestedPath);
  json(response, 200, { path: requestedPath, content, size: info.size, updatedAt: info.mtime.toISOString(), mime, renderable: isRenderableMime(mime) });
}

async function rebootWorkspace(response: ServerResponse): Promise<void> {
  if (workspaceDir === "/" || workspaceDir.length < 8) throw new Error(`Refusing to reboot unsafe workspace path: ${workspaceDir}`);
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  json(response, 200, { ok: true, files: [] });
}

function resolveWorkspaceFilePath(requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) throw new Error("File paths must be relative to the workspace.");
  const resolved = path.resolve(workspaceDir, requestedPath);
  if (resolved !== workspaceDir && !resolved.startsWith(`${workspaceDir}${path.sep}`)) throw new Error(`Path escapes the workspace: ${requestedPath}`);
  return resolved;
}

function fileMime(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".json") return "application/json";
  if (extension === ".md") return "text/markdown";
  if ([".js", ".ts", ".tsx", ".jsx", ".css", ".txt", ".xml"].includes(extension)) return "text/plain";
  return "application/octet-stream";
}

function isRenderableMime(mime: string): boolean {
  return mime === "text/html" || mime === "image/svg+xml";
}

async function persistTrace(kind: string, input: string, trace: TraceStep[], metadata?: StateWeaveRunMetadata): Promise<void> {
  if (!trace.length) return;
  try {
    await mkdir(traceDir, { recursive: true });
    const createdAt = new Date().toISOString();
    const name = `${Date.now()}-${safeFilePart(kind)}-${safeFilePart(input).slice(0, 64) || "stateweave"}.json`;
    await writeFile(path.join(traceDir, name), JSON.stringify({ kind, input, createdAt, metadata, trace }, null, 2));
  } catch (error) {
    console.error(`Failed to persist StateWeave trace: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function safeEvalCases(value: unknown[]): EvalCase[] {
  return value.flatMap((item): EvalCase[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { prompt?: unknown; expect?: unknown; categories?: unknown };
    if (typeof candidate.prompt !== "string" || typeof candidate.expect !== "string") return [];
    const prompt = candidate.prompt.trim();
    const expect = candidate.expect.trim();
    if (!prompt || !expect) return [];
    const categories = Array.isArray(candidate.categories) ? candidate.categories.filter((category): category is string => typeof category === "string") : [];
    return [{ prompt, expect, categories }];
  });
}

function isJudgeVote(value: unknown): value is JudgeVote {
  return value === "a" || value === "b" || value === "both" || value === "neither";
}

async function serveStatic(pathname: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(distDir, relativePath);

  if (!candidate.startsWith(distDir)) {
    json(response, 403, { error: "Forbidden" });
    return;
  }

  const filePath = await existingFile(candidate).catch(() => path.join(distDir, "index.html"));
  const fileStat = await stat(filePath);
  response.writeHead(200, {
    "content-type": contentType(filePath),
    "content-length": fileStat.size,
    "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
  });

  if (headOnly) {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function existingFile(filePath: string): Promise<string> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("not a file");
  return filePath;
}

async function proxyInfiniteApp(request: IncomingMessage, response: ServerResponse, arm: "stateweave" | "native", targetPath: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const target = `http://127.0.0.1:${arm === "stateweave" ? 3101 : 3102}${targetPath}`;
  const upstream = await fetch(target, {
    method: request.method,
    headers: { "content-type": request.headers["content-type"] ?? "application/octet-stream" },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks)
  });
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  let payload = Buffer.from(await upstream.arrayBuffer());
  if (/text\/html|text\/javascript/.test(contentType)) {
    const prefix = `${basePath === "/" ? "" : basePath.slice(0, -1)}/api/infinite-agent/apps/${arm}`;
    const text = payload.toString("utf8")
      .replaceAll('href="/', `href="${prefix}/`)
      .replaceAll('src="/', `src="${prefix}/`)
      .replaceAll('"/api/', `"${prefix}/api/`);
    payload = Buffer.from(text);
  }
  response.writeHead(upstream.status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(payload);
}

function requestUrl(request: IncomingMessage): URL {
  const url = new URL(request.url ?? "/", "http://stateweave.local");
  if (basePath !== "/" && url.pathname.startsWith(basePath)) {
    url.pathname = url.pathname.slice(basePath.length - 1) || "/";
  }
  return url;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function isGraphFrame(value: unknown): value is GraphFrame {
  return Boolean(
    value &&
      typeof value === "object" &&
      "frame" in value &&
      "graph" in value &&
      typeof (value as { frame?: unknown }).frame === "object" &&
      typeof (value as { graph?: unknown }).graph === "object"
  );
}

function safeMaxIterations(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return 30;
  return numeric;
}

function safeSystemPrompt(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 12_000) : undefined;
}

function safeNodeTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nodeTypes = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => /^[a-z][a-z0-9_-]{0,63}$/.test(item));
  return [...new Set(nodeTypes)].slice(0, 64);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function normalizeBasePath(value: string): string {
  if (!value || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

function providerName(): string {
  return process.env.STATEWEAVE_MODEL_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock");
}

function safeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as { role?: unknown; content?: unknown };
      return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
    })
    .slice(-12);
}

function regularModelInput(history: ChatMessage[], input: string): ModelMessage[] {
  return [...history, { role: "user", content: input }];
}

function serializeMessages(messages: ModelMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function emptyFrame(objective: string): GraphFrame {
  return {
    frame: {
      objective,
      currentFocus: "traditional messages baseline",
      nextExpectedOutput: "assistant text",
      activeConstraints: [],
      availableActions: []
    },
    graph: { nodes: [], edges: [] }
  };
}

function buildJudgePrompt(args: { prompt: string; gold: string; answerA: string; answerB: string; categories: string[] }): string {
  const sameAnswerHint = equivalentAnswerText(args.answerA, args.answerB)
    ? "A and B appear textually equivalent. If that shared answer matches the gold, choose BOTH; if it does not, choose NEITHER. Do not choose a single side for equivalent answers."
    : "";
  return [
    "Evaluate a blind A/B answer comparison.",
    "Use the gold answer as the source of truth. The tested models did not see the gold answer.",
    "If both answers are correct enough, choose BOTH. If neither is correct enough, choose NEITHER.",
    "A/B are anonymous slots, not competitors by style. Do not pick A or B when both contain the same correct final answer.",
    sameAnswerHint,
    `Categories: ${args.categories.length ? args.categories.join(", ") : "none"}`,
    "",
    "PROMPT:",
    args.prompt,
    "",
    "GOLD ANSWER:",
    args.gold,
    "",
    "ANSWER A:",
    args.answerA,
    "",
    "ANSWER B:",
    args.answerB,
    "",
    "Return exactly:",
    "WINNER: A|B|BOTH|NEITHER",
    "REASON: <one short sentence>"
  ].join("\n");
}

function parseJudgeVote(raw: string): { vote: JudgeVote; reason: string } {
  const winner = raw.match(/WINNER\s*:\s*(A|B|BOTH|NEITHER)/i)?.[1]?.toLowerCase();
  const reason = raw.match(/REASON\s*:\s*([^\n]+)/i)?.[1]?.trim() ?? raw.trim().slice(0, 240);
  if (winner === "a" || winner === "b" || winner === "both" || winner === "neither") return { vote: winner, reason };
  return { vote: "neither", reason: reason || "Judge response did not contain a valid WINNER line." };
}

function coerceJudgeVote(parsed: { vote: JudgeVote; reason: string }, args: { gold: string; answerA: string; answerB: string }): { vote: JudgeVote; reason: string } {
  if ((parsed.vote === "a" || parsed.vote === "b") && equivalentAnswerText(args.answerA, args.answerB)) {
    return {
      vote: "both",
      reason: `${parsed.reason} A and B are textually equivalent, so a one-sided judge vote was coerced to BOTH.`
    };
  }
  return parsed;
}

function equivalentAnswerText(a: string, b: string): boolean {
  const normalizedA = normalizeAnswerText(a);
  const normalizedB = normalizeAnswerText(b);
  return Boolean(normalizedA && normalizedA === normalizedB);
}

function normalizeAnswerText(value: string): string {
  return value
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*|```/g, ""))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function shuffle<T>(values: T[]): T[] {
  return [...values].sort(() => Math.random() - 0.5);
}

