import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CodexResponsesModel } from "../llm/codexModel.js";
import { CodexAccount, CodexSafeError } from "./codexAccount.js";
import { CodexCostBench, defaultPricing, halcyonScript, type Pricing } from "./codexCostBench.js";

// One operator connection at a time, bound to the browser that started it.
type Slot = { account: CodexAccount; sid: string; login?: { verificationUrl: string; userCode: string }; createdAt: number };
let slot: Slot | undefined;
const cookieName = "sw_codex";
const loginTtlMs = 15 * 60_000;

export type CodexRouteContext = {
  readJson: (request: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  reportDir: string;
};

let bench: CodexCostBench | undefined;

function send(response: ServerResponse, status: number, body: unknown, cookie?: string): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...(cookie ? { "set-cookie": cookie } : {}) });
  response.end(JSON.stringify(body));
}

function sidFrom(request: IncomingMessage): string | undefined {
  const match = /(?:^|;\s*)sw_codex=([A-Za-z0-9_-]{43})/.exec(request.headers.cookie ?? "");
  return match?.[1];
}

function owns(request: IncomingMessage): boolean {
  const sid = sidFrom(request);
  if (!slot || !sid) return false;
  const a = Buffer.from(sid);
  const b = Buffer.from(slot.sid);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function errorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof CodexSafeError) return { status: error.status, message: error.message };
  return { status: 500, message: "The Codex action failed. Nothing secret was recorded." };
}

function publicStatus(request: IncomingMessage) {
  const mine = owns(request);
  return {
    connected: Boolean(mine && slot?.account.connected),
    pending: Boolean(mine && slot && !slot.account.connected && !slot.account.error),
    busyElsewhere: Boolean(slot && !mine),
    error: mine ? slot?.account.error : undefined,
    login: mine && slot && !slot.account.connected ? slot.login : undefined,
    models: mine && slot?.account.connected ? slot.account.models ?? [] : [],
    defaultPricing,
    scriptTurns: halcyonScript.length
  };
}

async function dropSlot(): Promise<void> {
  const current = slot;
  slot = undefined;
  bench?.stop();
  await current?.account.destroy().catch(() => undefined);
}

function readPricing(raw: unknown): Pricing {
  const value = (raw ?? {}) as Record<string, unknown>;
  const read = (key: string) => {
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < 0 || number > 1000) throw new CodexSafeError("Prices must be USD per 1M tokens between 0 and 1000.", 400);
    return number;
  };
  return { input: read("input"), cachedInput: read("cachedInput"), output: read("output") };
}

/** Returns true when the request was a Codex lab route. */
export async function handleCodexRoute(request: IncomingMessage, response: ServerResponse, pathname: string, context: CodexRouteContext): Promise<boolean> {
  if (!pathname.startsWith("/api/codex")) return false;
  bench ??= new CodexCostBench(context.reportDir);

  if (request.method !== "GET" && !sameOrigin(request)) {
    send(response, 403, { error: "Cross-origin request refused." });
    return true;
  }

  try {
    if (request.method === "GET" && pathname === "/api/codex/status") {
      send(response, 200, publicStatus(request));
      return true;
    }
    if (request.method === "POST" && pathname === "/api/codex/login") {
      if (slot && !owns(request) && Date.now() - slot.createdAt < loginTtlMs && !slot.account.connected) {
        send(response, 409, { error: "Another browser is connecting a Codex subscription. Try again shortly." });
        return true;
      }
      if (slot && !owns(request) && slot.account.connected) {
        send(response, 409, { error: "Another browser is connected. It must disconnect first." });
        return true;
      }
      await dropSlot();
      const sid = randomBytes(32).toString("base64url");
      const account = await CodexAccount.create();
      slot = { account, sid, createdAt: Date.now() };
      try {
        slot.login = await account.startLogin();
      } catch (error) {
        await dropSlot();
        throw error;
      }
      const cookie = `${cookieName}=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
      send(response, 200, { login: slot.login }, cookie);
      return true;
    }
    if (request.method === "POST" && pathname === "/api/codex/disconnect") {
      if (owns(request)) await dropSlot();
      send(response, 200, { connected: false }, `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      return true;
    }
    if (request.method === "GET" && pathname === "/api/codex-bench/state") {
      send(response, 200, { run: owns(request) ? bench.state ?? null : null });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/codex-bench/stop") {
      if (owns(request)) bench.stop();
      send(response, 200, { run: owns(request) ? bench.state ?? null : null });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/codex-bench/start") {
      if (!owns(request) || !slot?.account.connected) throw new CodexSafeError("Connect your own Codex subscription first.", 401);
      if (bench.running) throw new CodexSafeError("A bench run is already in progress.", 409);
      const body = (await context.readJson(request, 10_000)) as Record<string, unknown>;
      const account = slot.account;
      const selection = account.choose({ model: body.model, thinking: body.thinking ?? "" });
      const pricing = readPricing(body.pricing);
      const turns = Number(body.turns ?? 10);
      if (!Number.isInteger(turns) || turns < 1 || turns > halcyonScript.length) throw new CodexSafeError(`Turns must be between 1 and ${halcyonScript.length}.`, 400);
      const runKey = randomBytes(12).toString("hex");
      const run = bench.start({ createModel: (arm) => new CodexResponsesModel(selection, () => account.headers(), fetch, `stateweave-lab-${runKey}-${arm}`), selection, pricing, turns });
      send(response, 202, { run });
      return true;
    }
    send(response, 404, { error: "Not found" });
  } catch (error) {
    const { status, message } = errorStatus(error);
    send(response, status, { error: message });
  }
  return true;
}
