import "dotenv/config";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStateWeave, streamStateWeave } from "../agent/stateweaveRunner.js";
import type { GraphFrame } from "../core/types.js";
import { createModelFromEnv } from "../llm/factory.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";
import { mockTools } from "../tools/mockTools.js";

type RunRequest = {
  input?: unknown;
  frame?: unknown;
  maxSteps?: unknown;
  messages?: unknown;
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type ModelMessage = { role: "user" | "assistant"; content: string };

const port = Number(process.env.PORT ?? 3000);
const basePath = normalizeBasePath(process.env.STATEWEAVE_WEB_BASE_PATH ?? "/");
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist-web");
const model = createModelFromEnv();

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
    json(response, 200, { ok: true, provider: providerName() });
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

  try {
    for await (const event of streamStateWeave(
      { model, tools: mockTools, maxSteps: safeMaxSteps(body.maxSteps) },
      body.input,
      { frame: isGraphFrame(body.frame) ? body.frame : undefined }
    )) {
      response.write(`${JSON.stringify(event)}\n`);
    }
  } catch (error) {
    response.write(`${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) })}\n`);
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
  const stateweave = await runStateWeave(
    { model, tools: mockTools, maxSteps: safeMaxSteps(body.maxSteps) },
    input,
    { frame: isGraphFrame(body.frame) ? body.frame : undefined }
  );

  json(response, 200, {
    stateweave: {
      inputFrame: stateweave.trace[0]?.frameBefore,
      frameAfter: stateweave.trace.at(-1)?.frameAfter,
      output: stateweave.finalAnswer,
      trace: stateweave.trace,
      graph: stateweave.graph
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
  const history = safeChatMessages(body.messages);
  const traditionalMessages = regularModelInput(history, input);
  const regularPrompt = serializeMessages(traditionalMessages);
  const stateFrame = isGraphFrame(body.frame) ? body.frame : undefined;
  const [regular, stateweave] = await Promise.all([
    model.complete({ prompt: regularPrompt, mode: "text", frame: emptyFrame(input) }),
    runStateWeave({ model, tools: mockTools, maxSteps: safeMaxSteps(body.maxSteps) }, input, { frame: stateFrame })
  ]);

  json(response, 200, {
    traditional: {
      messages: traditionalMessages,
      rawModelInput: regularPrompt,
      output: regular.text,
      tokenEstimate: { ...estimateStateWeaveTokens(regularPrompt), messageCount: traditionalMessages.length },
      history: [...history, { role: "user", content: input }, { role: "assistant", content: regular.text }]
    },
    stateweave: {
      inputFrame: stateweave.trace[0]?.frameBefore,
      frameAfter: stateweave.trace.at(-1)?.frameAfter,
      output: stateweave.finalAnswer,
      trace: stateweave.trace,
      graph: stateweave.graph
    }
  });
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

function safeMaxSteps(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return 5;
  return Math.min(numeric, 8);
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

