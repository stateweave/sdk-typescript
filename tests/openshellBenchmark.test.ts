import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { oneShotSdkBuildPrompt } from "../src/evals/oneShotSdkBenchmark.js";

const root = new URL("../ops/openshell-benchmark/", import.meta.url);

describe("OpenShell SDK build benchmark", () => {
  it("preserves the historical graph/transcript arms and runs the promoted agent under the same task", async () => {
    const runner = await readFile(new URL("participant-runner.mjs", root), "utf8");
    expect(runner).toContain("GraphFrameAgent");
    expect(runner).toContain("AgenticBaseline");
    expect(runner).toContain("new Agent(");
    expect(runner).toContain("oneShotSdkBuildPrompt");
    expect(runner).toContain('PARTICIPANT_MAX_ITERATIONS ?? "300"');
    expect(runner).toContain("maxIterations > 3_000");
    expect(runner).toContain("maxPromptTokens: 250_000");
    expect(runner).toContain("maxContextTokens: 250_000");
    expect(runner).toContain("projectionTargetTokens: 16_000");
    expect(runner).toContain("thresholdTokens: 250_000");
    expect(runner).toContain('name: "bash_command"');
    expect(runner).toContain("runSandboxShell");
    expect(runner).toContain('maxNoProgressIterations: 300');
    expect(runner).toContain('replaceAll("/dev/null", "/tmp/.stateweave-null")');
    expect(runner).toContain("isGeneratedWorkspacePath");
    expect(runner).toContain('"logs", "tmp"');
    expect(runner).not.toContain("convergence_guard");
    expect(runner).toContain("frame.checkpoint.json");
    expect(runner).not.toContain(oneShotSdkBuildPrompt);
  });

  it("keeps sandboxing hard-required and ordinary network default-deny", async () => {
    const policy = await readFile(new URL("policy.yaml", root), "utf8");
    expect(policy).toContain("compatibility: hard_requirement");
    expect(policy).toContain("run_as_user: sandbox");
    expect(policy).toContain("network_policies: {}");
    expect(policy).not.toContain("/dev/null");
    expect(policy).not.toContain("/dev/urandom");
  });

  it("never starts a run merely because the worker service starts", async () => {
    const worker = await readFile(new URL("worker.mjs", root), "utf8");
    expect(worker).toContain('exists(startRequestPath)');
    expect(worker).toContain('exists(retryRequestPath)');
    expect(worker).toContain('exists(variantCRequestPath)');
    expect(worker).toContain('runParticipant(state.variantC, "causal"');
    expect(worker).toContain('request.runtimeCorrection === true && previous');
    expect(worker).toContain('causal-variant-c-attempt-${attempt}');
    expect(worker).toContain('request.maxIterations !== 3_000');
    expect(worker).toContain('request.runtimeCorrection === true && armState.status === "completed"');
    expect(worker).toContain('reason: runtimeCorrection ? "runtime-correction" : "failed-candidate"');
    expect(worker).toContain('exists(path.join(runDir, "judgement.json"))');
    expect(worker).toContain('state.status !== "ready"');
    expect(worker).toContain('Math.random() < 0.5');
    expect(worker).toContain("security-probe.mjs");
    expect(worker).toContain('"3Gi"');
    expect(worker).toContain('"/bin/true"');
    expect(worker).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(worker).toContain("{{.State.OOMKilled}}");
    expect(worker.indexOf("class StopRequestedError")).toBeLessThan(worker.indexOf("while (!stopping)"));
    expect(worker).not.toMatch(/processRun\(\)\s*;\s*$/m);
  });

  it("provides identical offline dependencies to both fresh workspaces", async () => {
    const manifest = JSON.parse(await readFile(new URL("workspace-seed/package.json", root), "utf8"));
    expect(manifest.dependencies).toEqual({ mathlive: "0.110.0", nerdamer: "1.1.13" });
    expect(manifest.devDependencies).toEqual({ vite: "8.1.3", vitest: "2.1.9" });
    const notes = await readFile(new URL("workspace-seed/WORKSPACE.md", root), "utf8");
    expect(notes).toContain("vendor/desmos.js");
    expect(notes).toContain("outbound network access is denied");
    const prepare = await readFile(new URL("prepare-payload.sh", root), "utf8");
    expect(prepare).toContain('cp -a ops/openshell-benchmark/workspace-seed/. "$target_root/workspace-seed/"');
  });
});
