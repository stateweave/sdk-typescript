import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { oneShotPromptStats, oneShotSdkBuildPrompt, sdkBuildBenchmarkVersion, type SdkBuildBenchmarkState } from "../src/evals/oneShotSdkBenchmark.js";
import { SdkBuildBenchmarkApi } from "../src/web/sdkBuildBenchmark.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("SDK build benchmark API", () => {
  it("does not claim OpenShell is ready before the worker initializes", async () => {
    const root = await temporaryRoot();
    const state = await new SdkBuildBenchmarkApi(root).publicState();
    expect(state.status).toBe("worker_offline");
    expect(state.canStart).toBe(false);
  });

  it("queues exactly one fixed start request while the worker is ready", async () => {
    const root = await temporaryRoot();
    await writeState(root, readyState());
    const api = new SdkBuildBenchmarkApi(root);
    const first = await api.start();
    const second = await api.start();
    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    const request = JSON.parse(await readFile(path.join(root, "requests/start.json"), "utf8"));
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request).not.toHaveProperty("prompt");
  });

  it("queues only the failed blind candidate for a disclosed 3000-iteration retry", async () => {
    const root = await temporaryRoot();
    const state: SdkBuildBenchmarkState = {
      ...readyState(),
      status: "completed",
      message: "One candidate failed.",
      runId: "run_retry",
      executionOrder: ["transcript", "graph"],
      labels: { a: "transcript", b: "graph" },
      arms: {
        graph: { slot: 2, status: "failed", error: "Recursion limit reached" },
        transcript: { slot: 1, status: "completed", finalAnswer: "Done" }
      }
    };
    await writeState(root, state);
    await mkdir(path.join(root, "runs/run_retry"), { recursive: true });
    const api = new SdkBuildBenchmarkApi(root);
    const blind = await api.publicState();
    expect(blind).toMatchObject({ canRetryFailed: true, failedCandidate: "b" });
    expect((await api.retryFailed({ candidate: "a", maxIterations: 3_000 })).status).toBe(409);
    expect((await api.retryFailed({ candidate: "b", maxIterations: 300 })).status).toBe(400);
    expect((await api.retryFailed({ candidate: "b", maxIterations: 3_000 })).status).toBe(202);
    expect((await api.retryFailed({ candidate: "b", maxIterations: 3_000 })).status).toBe(409);
    const request = JSON.parse(await readFile(path.join(root, "requests/retry-failed.json"), "utf8"));
    expect(request).toMatchObject({ candidate: "b", maxIterations: 3_000 });
    expect(request).not.toHaveProperty("arm");
  });

  it("serves candidate output through a sandboxed no-store preview response", async () => {
    const root = await temporaryRoot();
    const state: SdkBuildBenchmarkState = {
      ...readyState(),
      status: "completed",
      message: "Ready for blind review.",
      runId: "run_preview",
      executionOrder: ["graph", "transcript"],
      labels: { a: "graph", b: "transcript" },
      arms: {
        graph: { slot: 1, status: "completed", previewRoot: "dist", artifactKey: "graph-attempt-2" },
        transcript: { slot: 2, status: "completed" }
      }
    };
    await writeState(root, state);
    const previewDir = path.join(root, "runs/run_preview/artifacts/graph-attempt-2/workspace/dist");
    await mkdir(previewDir, { recursive: true });
    await writeFile(path.join(previewDir, "index.html"), '<!doctype html><script type="module" src="/assets/app.js"></script>');
    const api = new SdkBuildBenchmarkApi(root);
    const server = createServer((request, response) => void api.servePreview(response, "a", "", request.method === "HEAD"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.text()).toContain('src="./assets/app.js"');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps candidate identities and efficiency hidden until human scores are submitted", async () => {
    const root = await temporaryRoot();
    const state: SdkBuildBenchmarkState = {
      ...readyState(),
      status: "completed",
      message: "Ready for blind review.",
      runId: "run_one",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executionOrder: ["graph", "transcript"],
      labels: { a: "transcript", b: "graph" },
      arms: {
        graph: { slot: 1, status: "completed", finalAnswer: "Graph answer", previewRoot: "dist", metrics: metrics(7, 5) },
        transcript: { slot: 2, status: "completed", finalAnswer: "Transcript answer", previewRoot: ".", metrics: metrics(9, 6) }
      }
    };
    await writeState(root, state);
    await mkdir(path.join(root, "runs/run_one"), { recursive: true });
    const api = new SdkBuildBenchmarkApi(root);
    const blind = await api.publicState();
    const blindJson = JSON.stringify(blind);
    expect(blindJson).not.toContain("StateWeave graph memory");
    expect(blindJson).not.toContain("Native transcript memory");
    expect(blindJson).not.toContain("modelCalls");

    const submitted = await api.judge({ scoreA: 74.5, scoreB: 88, notes: "Reviewed both before reveal." });
    expect(submitted.status).toBe(200);
    const revealed = await api.publicState();
    expect(revealed.judgement).toMatchObject({
      scoreA: 74.5,
      scoreB: 88,
      reveal: { a: "Native transcript memory", b: "StateWeave graph memory" }
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdk-build-benchmark-"));
  roots.push(root);
  return root;
}

async function writeState(root: string, state: SdkBuildBenchmarkState): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "state.json"), JSON.stringify(state));
}

function readyState(): SdkBuildBenchmarkState {
  return {
    version: sdkBuildBenchmarkVersion,
    status: "ready",
    message: "Ready.",
    promptSha256: createHash("sha256").update(oneShotSdkBuildPrompt).digest("hex"),
    promptWords: oneShotPromptStats().words,
    workerHeartbeatAt: new Date().toISOString(),
    arms: { graph: { slot: 1, status: "waiting" }, transcript: { slot: 2, status: "waiting" } }
  };
}

function metrics(modelCalls: number, toolCalls: number) {
  return { modelCalls, toolCalls, latestContextTokens: 100, totalInputTokens: 500, outputTokens: 200, durationMs: 1_000 };
}
