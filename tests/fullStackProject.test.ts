import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FullStackAppRuntime, inspectFrontendCoherence } from "../src/evals/fullStackProject.js";

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

    runtime.setQualityGate(async () => ({ ok: false, details: ["requested feature is incomplete"] }));
    expect(await runtime.smoke()).toMatchObject({ ok: false, healthy: true, acceptance: { ok: false, details: ["requested feature is incomplete"] } });
  });

  it("rejects frontend selector and styling drift during checks and smoke tests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "relaydesk-coherence-"));
    const port = await availablePort();
    const runtime = new FullStackAppRuntime(root, port);
    cleanups.push(async () => { await runtime.stop(); await rm(root, { recursive: true, force: true }); });

    await runtime.initialize();
    const htmlPath = path.join(root, "public/index.html");
    const appPath = path.join(root, "public/app.js");
    await writeFile(htmlPath, (await readFile(htmlPath, "utf8")).replace("<main>", "<main class=\"unstyled-shell\">"));
    await writeFile(appPath, `${await readFile(appPath, "utf8")}\nconst missing = document.querySelector(\"#missing-summary\");\n`);

    expect(await inspectFrontendCoherence(root)).toMatchObject({ ok: false, missingElementIds: ["missing-summary"], unstyledClasses: ["unstyled-shell"] });
    expect(await runtime.check()).toMatchObject({ ok: false, frontend: { ok: false } });
    expect(await runtime.smoke()).toMatchObject({ ok: false, healthy: true, pageOk: true, frontendOk: false });
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
