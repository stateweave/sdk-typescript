import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSandboxShell } from "../ops/openshell-benchmark/sandbox-shell.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("benchmark sandbox shell", () => {
  it("closes piped stdin without opening Landlock-denied /dev/null", async () => {
    const source = await readFile(new URL("../ops/openshell-benchmark/sandbox-shell.mjs", import.meta.url), "utf8");
    expect(source).toContain('spawn("/usr/bin/bash"');
    expect(source).toContain('stdio: ["pipe", "pipe", "pipe"]');
    expect(source).toContain("child.stdin.end()");
    expect(source).not.toContain('stdio: ["ignore"');
  });

  it("returns output for a successful bounded command", async () => {
    const result = await runSandboxShell({ command: "printf shell-ok", cwd: process.cwd(), env: process.env, timeoutMs: 5_000 });
    expect(result).toMatchObject({ ok: true, exitCode: 0, stdout: "shell-ok", timedOut: false, aborted: false });
  });

  it("cleans up background descendants after a successful shell exits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-shell-"));
    roots.push(root);
    const result = await runSandboxShell({ command: "sleep 30 & echo $! > child.pid", cwd: root, env: process.env, timeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    const childPid = Number((await readFile(path.join(root, "child.pid"), "utf8")).trim());
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(access(`/proc/${childPid}`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("kills the complete process group on timeout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-shell-"));
    roots.push(root);
    const result = await runSandboxShell({
      command: "sleep 30 & echo $! > child.pid; wait",
      cwd: root,
      env: process.env,
      timeoutMs: 150
    });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    const childPid = Number((await readFile(path.join(root, "child.pid"), "utf8")).trim());
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(access(`/proc/${childPid}`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
