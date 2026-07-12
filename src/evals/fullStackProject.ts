import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool } from "../tools/types.js";

const appControlSchema = z.object({ action: z.enum(["restart", "status", "smoke", "check"]) });

export class FullStackAppRuntime {
  private process?: ChildProcess;
  private logs: string[] = [];
  private qualityGate?: () => Promise<{ ok: boolean; details?: string[] }>;

  constructor(readonly rootDir: string, readonly port: number) {}

  setQualityGate(gate?: () => Promise<{ ok: boolean; details?: string[] }>): void {
    this.qualityGate = gate;
  }

  async initialize(): Promise<void> {
    await seedFullStackProject(this.rootDir);
    await this.restart();
  }

  tool(): Tool {
    return {
      name: "app_control",
      description: "Manage this workspace's isolated RelayDesk application. action=restart reloads code, status reports process health, smoke checks live health/API/UI, and check runs fixed server syntax plus Node tests. No arbitrary process or network access is available.",
      schema: appControlSchema,
      execute: async (args: unknown) => {
        const { action } = appControlSchema.parse(args);
        if (action === "restart") return this.restart();
        if (action === "smoke") return this.smoke();
        if (action === "check") return this.check();
        return this.status();
      }
    };
  }

  async restart(): Promise<Record<string, unknown>> {
    await this.stop();
    this.logs = [];
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: this.rootDir,
      env: { PATH: process.env.PATH, HOME: this.rootDir, PORT: String(this.port), DATA_FILE: "data/relaydesk.db", NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.process = child;
    child.stdout?.on("data", (chunk) => this.capture(String(chunk)));
    child.stderr?.on("data", (chunk) => this.capture(String(chunk)));
    await new Promise((resolve) => setTimeout(resolve, 350));
    return this.smoke();
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1_000))
    ]);
  }

  async check(): Promise<Record<string, unknown>> {
    const run = (args: string[]) => new Promise<{ ok: boolean; output: string }>((resolve) => execFile(process.execPath, args, { cwd: this.rootDir, timeout: 30_000, maxBuffer: 64_000 }, (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}${stderr}`.slice(-12_000) })));
    const serverSyntax = await run(["--check", "src/server.js"]);
    const clientSyntax = serverSyntax.ok ? await run(["--check", "public/app.js"]) : { ok: false, output: "Skipped because server syntax check failed." };
    const frontend = await inspectFrontendCoherence(this.rootDir);
    const tests = serverSyntax.ok && clientSyntax.ok && frontend.ok ? await run(["--test"]) : { ok: false, output: "Skipped because syntax or frontend coherence checks failed." };
    const acceptance = await this.runQualityGate();
    return { ok: serverSyntax.ok && clientSyntax.ok && frontend.ok && tests.ok && acceptance.ok, syntax: serverSyntax, clientSyntax, frontend, tests, acceptance };
  }

  async status(): Promise<Record<string, unknown>> {
    return { running: Boolean(this.process && this.process.exitCode === null), port: this.port, pid: this.process?.pid, logs: this.logs.slice(-12) };
  }

  async smoke(): Promise<Record<string, unknown>> {
    try {
      const [health, page, client, styles, frontend, acceptance] = await Promise.all([
        fetch(`http://127.0.0.1:${this.port}/api/health`, { signal: AbortSignal.timeout(2_000) }),
        fetch(`http://127.0.0.1:${this.port}/`, { signal: AbortSignal.timeout(2_000) }),
        fetch(`http://127.0.0.1:${this.port}/app.js`, { signal: AbortSignal.timeout(2_000) }),
        fetch(`http://127.0.0.1:${this.port}/styles.css`, { signal: AbortSignal.timeout(2_000) }),
        inspectFrontendCoherence(this.rootDir),
        this.runQualityGate()
      ]);
      const assetsOk = client.ok && styles.ok;
      const ok = health.ok && page.ok && assetsOk && frontend.ok && acceptance.ok;
      return { ...(await this.status()), ok, healthy: health.ok, pageOk: page.ok, assetsOk, frontendOk: frontend.ok, frontend, acceptance, health: await health.text() };
    } catch (error) {
      return { ...(await this.status()), ok: false, healthy: false, pageOk: false, assetsOk: false, frontendOk: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async runQualityGate(): Promise<{ ok: boolean; details?: string[] }> {
    if (!this.qualityGate) return { ok: true };
    try {
      return await this.qualityGate();
    } catch (error) {
      return { ok: false, details: [error instanceof Error ? error.message : String(error)] };
    }
  }

  private capture(value: string): void {
    this.logs.push(...value.trim().split(/\r?\n/).filter(Boolean));
    this.logs = this.logs.slice(-80);
  }
}

export type FrontendCoherence = {
  ok: boolean;
  missingElementIds: string[];
  unstyledClasses: string[];
  assetsReferenced: boolean;
};

export async function inspectFrontendCoherence(root: string): Promise<FrontendCoherence> {
  try {
    const [html, app, css] = await Promise.all([
      readFile(path.join(root, "public/index.html"), "utf8"),
      readFile(path.join(root, "public/app.js"), "utf8"),
      readFile(path.join(root, "public/styles.css"), "utf8")
    ]);
    const elementIds = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]!));
    const selectedIds = new Set([
      ...[...app.matchAll(/querySelector\(\s*["'`]#([A-Za-z][\w:-]*)["'`]\s*\)/g)].map((match) => match[1]!),
      ...[...app.matchAll(/getElementById\(\s*["'`]([A-Za-z][\w:-]*)["'`]\s*\)/g)].map((match) => match[1]!)
    ]);
    const missingElementIds = [...selectedIds].filter((id) => !elementIds.has(id)).sort();
    const usedClasses = new Set<string>();
    for (const source of [html, app]) {
      for (const match of source.matchAll(/\bclass\s*=\s*["']([^"']+)["']/g)) {
        for (const token of match[1]!.split(/\s+/)) {
          if (/^[A-Za-z_][\w-]*$/.test(token)) usedClasses.add(token);
        }
      }
    }
    const styledClasses = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]!));
    const unstyledClasses = [...usedClasses].filter((name) => !styledClasses.has(name)).sort();
    const assetsReferenced = /href=["']\/styles\.css["']/.test(html) && /src=["']\/app\.js["']/.test(html);
    return { ok: assetsReferenced && !missingElementIds.length && !unstyledClasses.length, missingElementIds, unstyledClasses, assetsReferenced };
  } catch {
    return { ok: false, missingElementIds: [], unstyledClasses: [], assetsReferenced: false };
  }
}

export function relayDeskSeedStyles(): string {
  return stylesSource();
}

export async function seedFullStackProject(root: string): Promise<void> {
  await mkdir(path.join(root, "data"), { recursive: true });
  if (await exists(path.join(root, "package.json"))) return;
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "relaydesk", private: true, type: "module", scripts: { start: "node src/server.js", check: "node --check src/server.js", test: "node --test" } }, null, 2)}\n`,
    "README.md": `# RelayDesk\n\nRelayDesk is an internal full-stack operations workspace. It has a Node.js API, SQLite persistence, and a dependency-free browser frontend. Keep API compatibility, data migrations, accessibility, and existing behavior intact as the product evolves.\n\nUse the app_control tool to restart or smoke-test the isolated application after code changes.\n`,
    "PRODUCT.md": `# Product constraints\n\n- The application is called RelayDesk.\n- Store durable product data in SQLite, never only in browser memory.\n- Keep /api/health backward compatible.\n- Return JSON errors with an error field and an appropriate HTTP status.\n- The frontend must remain usable on mobile and keyboard accessible.\n- Do not add external packages or network dependencies.\n`,
    "src/server.js": serverSource(),
    "public/index.html": indexSource(),
    "public/app.js": appSource(),
    "public/styles.css": stylesSource(),
    "test/health.test.js": testSource()
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function exists(target: string): Promise<boolean> {
  try { await stat(target); return true; } catch { return false; }
}

function serverSource(): string {
  return `import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3100);
const db = new DatabaseSync(path.resolve(root, process.env.DATA_FILE || "data/relaydesk.db"));
db.exec("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");

const json = (response, status, value) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
const body = async (request) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); };

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  try {
    if (url.pathname === "/api/health") return json(response, 200, { ok: true, app: "RelayDesk" });
    if (url.pathname === "/api/projects" && request.method === "GET") return json(response, 200, { projects: db.prepare("SELECT * FROM projects ORDER BY id DESC").all() });
    if (url.pathname === "/api/projects" && request.method === "POST") {
      const input = await body(request);
      if (typeof input.name !== "string" || !input.name.trim()) return json(response, 400, { error: "name is required" });
      const result = db.prepare("INSERT INTO projects (name) VALUES (?)").run(input.name.trim());
      return json(response, 201, { project: db.prepare("SELECT * FROM projects WHERE id = ?").get(result.lastInsertRowid) });
    }
    if (url.pathname.startsWith("/api/")) return json(response, 404, { error: "not found" });
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) return json(response, 400, { error: "invalid path" });
    const content = await readFile(path.join(root, "public", relative));
    const type = relative.endsWith(".css") ? "text/css" : relative.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "content-type": type + "; charset=utf-8" }); response.end(content);
  } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.log(\`RelayDesk listening on \${port}\`));
`;
}

function indexSource(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RelayDesk</title><link rel="stylesheet" href="/styles.css"></head><body><main><header><p class="eyebrow">Operations workspace</p><h1>RelayDesk</h1><p>Track projects and evolve the team workspace safely.</p></header><section class="panel"><h2>New project</h2><form id="project-form"><label>Name <input id="project-name" required></label><button>Add project</button></form></section><section class="panel"><h2>Projects</h2><div id="projects" class="grid" aria-live="polite"></div></section></main><script type="module" src="/app.js"></script></body></html>`;
}

function appSource(): string {
  return `const list = document.querySelector("#projects");
const form = document.querySelector("#project-form");
const input = document.querySelector("#project-name");
async function load() { const response = await fetch("/api/projects"); const { projects } = await response.json(); list.innerHTML = projects.length ? projects.map(project => \`<article><strong>\${escapeHtml(project.name)}</strong><span>\${escapeHtml(project.status)}</span></article>\`).join("") : "<p>No projects yet.</p>"; }
form.addEventListener("submit", async event => { event.preventDefault(); const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: input.value }) }); if (response.ok) { input.value = ""; await load(); } });
function escapeHtml(value) { return String(value).replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[character]); }
load();
`;
}

function stylesSource(): string {
  return `:root{font-family:Inter,system-ui,sans-serif;color:#e7edf6;background:#07111f}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#172a46,#07111f 55%);min-height:100vh}main{width:min(980px,calc(100% - 32px));margin:0 auto;padding:48px 0}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#7dd3fc;font-weight:700}h1{font-size:clamp(2.4rem,8vw,5rem);margin:.1em 0}.panel{background:#0f1d30;border:1px solid #263a55;border-radius:18px;padding:22px;margin-top:22px}form{display:flex;gap:12px;align-items:end;flex-wrap:wrap}label{display:grid;gap:6px;flex:1}input,button{font:inherit;border-radius:10px;padding:12px;border:1px solid #3b506d}button{background:#7dd3fc;color:#07111f;font-weight:800;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.grid article{display:grid;gap:8px;padding:16px;background:#16263d;border-radius:12px}.grid span{color:#9fb0c7}@media(max-width:540px){main{padding:24px 0}form{display:grid}button{width:100%}}`;
}

function testSource(): string {
  return `import test from "node:test"; import assert from "node:assert/strict"; import { readFile } from "node:fs/promises"; test("RelayDesk keeps its health contract", async () => { const source = await readFile("src/server.js", "utf8"); assert.match(source, /\\/api\\/health/); assert.match(source, /RelayDesk/); });`;
}
