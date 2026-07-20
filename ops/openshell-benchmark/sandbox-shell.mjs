import { spawn } from "node:child_process";

export function runSandboxShell({ command, cwd, env, timeoutMs, signal, maxOutputBytes = 256_000 }) {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/bash", ["--noprofile", "--norc", "-lc", command], {
      cwd,
      env,
      detached: true,
      // Use a pipe rather than `ignore`: Node implements ignored stdin through
      // /dev/null, which hard-Landlock intentionally does not expose.
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceKillTimer;
    let exitCleanupTimer;
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      return next.length <= maxOutputBytes ? next : `${next.slice(0, maxOutputBytes)}\n...[truncated]`;
    };
    const killGroup = (killSignal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, killSignal); }
      catch { /* process group already exited */ }
    };
    const terminate = () => {
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => killGroup("SIGKILL"), 2_000);
      forceKillTimer.unref?.();
    };
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("exit", () => {
      // `close` waits for inherited pipes, so terminate background descendants
      // as soon as the shell leader exits rather than waiting for the timeout.
      killGroup("SIGTERM");
      exitCleanupTimer = setTimeout(() => killGroup("SIGKILL"), 100);
      exitCleanupTimer.unref?.();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (exitCleanupTimer) clearTimeout(exitCleanupTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, exitCode: 1, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`, timedOut, aborted });
    });
    child.once("close", (code, closeSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (exitCleanupTimer) clearTimeout(exitCleanupTimer);
      signal?.removeEventListener("abort", onAbort);
      // A successful shell can still leave background descendants. Never let one
      // tool call leak servers, test workers, or npm children into later calls.
      killGroup("SIGTERM");
      const exitCode = code ?? (timedOut ? 124 : aborted ? 130 : 1);
      setTimeout(() => {
        killGroup("SIGKILL");
        resolve({ ok: exitCode === 0 && !timedOut && !aborted, exitCode, signal: closeSignal ?? undefined, stdout, stderr, timedOut, aborted });
      }, 100);
    });
  });
}
