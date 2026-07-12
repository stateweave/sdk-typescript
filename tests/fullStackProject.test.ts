import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FullStackAppRuntime } from "../src/evals/fullStackProject.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("RelayDesk isolated runtime", () => {
  it("seeds, checks, starts, and serves the full-stack application", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relaydesk-"));
    const port = await availablePort();
    const runtime = new FullStackAppRuntime(root, port);
    cleanups.push(async () => { await runtime.stop(); await rm(root, { recursive: true, force: true }); });

    await runtime.initialize();
    expect(await readFile(path.join(root, "PRODUCT.md"), "utf8")).toContain("SQLite");
    expect(await runtime.check()).toMatchObject({ ok: true });
    expect(await runtime.smoke()).toMatchObject({ running: true, healthy: true, pageOk: true });

    const projects = await fetch(`http://127.0.0.1:${port}/api/projects`);
    expect(projects.status).toBe(200);
    expect(await projects.json()).toEqual({ projects: [] });
  });
});

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
