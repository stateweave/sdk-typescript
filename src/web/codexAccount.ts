// Port of DARE's isolated Codex subscription login. Each browser gets a fresh
// CODEX_HOME; the official CLI performs device-code auth and model discovery.
// Never create a Codex thread/turn (that would expose an agent and shell tools).
// Tokens and account IDs stay server-only and are never logged or returned.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexSelection } from "../llm/codexModel.js";

export class CodexSafeError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "CodexSafeError";
  }
}

export type CodexModelChoice = { id: string; label: string; isDefault: boolean; defaultThinking: string; thinkingLevels: string[] };

type RawModel = {
  model?: unknown;
  hidden?: unknown;
  displayName?: unknown;
  isDefault?: unknown;
  inputModalities?: unknown;
  upgradeInfo?: { retirementAt?: unknown };
  supportedReasoningEfforts?: Array<{ reasoningEffort?: unknown }>;
  defaultReasoningEffort?: unknown;
};

const effortPattern = /^[a-z_]{1,24}$/;

function efforts(model: RawModel): string[] {
  return [...new Set((model.supportedReasoningEfforts ?? []).map((value) => value?.reasoningEffort).filter((value): value is string => typeof value === "string" && effortPattern.test(value)))];
}

function visibleModels(models: RawModel[]): Array<RawModel & { model: string }> {
  return models.filter(
    (model): model is RawModel & { model: string } =>
      Boolean(model) &&
      !model.hidden &&
      typeof model.model === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/.test(model.model) &&
      (!Array.isArray(model.inputModalities) || model.inputModalities.includes("text")) &&
      !(typeof model.upgradeInfo?.retirementAt === "number" && model.upgradeInfo.retirementAt <= Date.now() / 1000)
  );
}

export function modelChoices(models: RawModel[]): CodexModelChoice[] {
  return visibleModels(models).map((model) => {
    const levels = efforts(model);
    const fallback = levels.includes("medium") ? "medium" : typeof model.defaultReasoningEffort === "string" && levels.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : levels[0] ?? "";
    return {
      id: model.model,
      label: typeof model.displayName === "string" ? model.displayName.slice(0, 120) : model.model,
      isDefault: Boolean(model.isDefault),
      defaultThinking: fallback,
      thinkingLevels: levels
    };
  });
}

export function chooseModel(options: CodexModelChoice[] | undefined, selection: unknown): CodexSelection {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new CodexSafeError("Choose a model and its supported thinking level.", 400);
  const value = selection as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "model" && key !== "thinking") || typeof value.model !== "string" || typeof value.thinking !== "string") {
    throw new CodexSafeError("Choose a model and its supported thinking level.", 400);
  }
  const option = options?.find((candidate) => candidate.id === value.model);
  if (!option) throw new CodexSafeError("That model is no longer available. Refresh and choose an available model.", 400);
  if (option.thinkingLevels.length ? !option.thinkingLevels.includes(value.thinking) : value.thinking !== "") {
    throw new CodexSafeError("That thinking level is not supported by this model.", 400);
  }
  return { model: option.id, ...(value.thinking ? { reasoningEffort: value.thinking } : {}) };
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

class NativeAuth {
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<void>;
  private stopping?: Promise<void>;

  constructor(home: string, onNotification: (event: { method: string; params?: any }) => void = () => undefined) {
    this.proc = spawn(process.env.CODEX_BIN || "codex", ["app-server", "--stdio", "-c", 'cli_auth_credentials_store="file"', "-c", "analytics.enabled=false", "-c", "feedback.enabled=false"], {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: "C.UTF-8", RUST_LOG: "off" },
      stdio: ["pipe", "pipe", "ignore"]
    }) as unknown as ChildProcessWithoutNullStreams;
    let resolveClosed!: () => void;
    this.closed = new Promise((resolve) => (resolveClosed = resolve));
    this.proc.stdin.on("error", () => undefined);
    this.proc.on("error", () => {
      this.fail();
      resolveClosed();
    });
    this.proc.on("close", () => {
      this.fail();
      resolveClosed();
    });
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      if (line.length > 1_000_000) return void this.stop();
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending.get(event.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(event.id);
        if (event.error) pending.reject(new CodexSafeError("Codex could not complete that authentication step. Enable device-code login in ChatGPT security settings, then reconnect.", 401));
        else pending.resolve(event.result);
      } else if (typeof event.method === "string") onNotification(event);
    });
  }

  private fail(): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new CodexSafeError("The Codex authentication service stopped. Reconnect to continue.", 401));
    }
    this.pending.clear();
  }

  rpc(method: string, params: unknown, timeout = 25_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexSafeError("Codex authentication timed out. Please reconnect.", 504));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n", (error) => {
        if (error && this.pending.delete(id)) {
          clearTimeout(timer);
          reject(new CodexSafeError("Codex authentication is unavailable.", 503));
        }
      });
    });
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", { clientInfo: { name: "stateweave_lab", title: "StateWeave Lab", version: "1.0.0" } });
    this.proc.stdin.write('{"method":"initialized"}\n');
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      this.fail();
      if (this.proc.exitCode !== null || this.proc.signalCode) return;
      this.proc.kill("SIGTERM");
      const timer = setTimeout(() => this.proc.kill("SIGKILL"), 1500);
      await this.closed;
      clearTimeout(timer);
    })();
    return this.stopping;
  }
}

async function discoverModels(native: NativeAuth): Promise<RawModel[]> {
  const models: RawModel[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await native.rpc("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }, 40_000);
    if (!Array.isArray(result?.data)) throw new CodexSafeError("Codex returned an unreadable model catalog. Reconnect to try again.");
    models.push(...result.data);
    if (!result.nextCursor) return models;
    if (typeof result.nextCursor !== "string" || cursors.has(result.nextCursor)) break;
    const next: string = result.nextCursor;
    cursor = next;
    cursors.add(next);
  }
  throw new CodexSafeError("Codex could not finish listing available models. Reconnect to try again.");
}

const headerTtlMs = 5 * 60_000;

export class CodexAccount {
  connected = false;
  closed = false;
  error?: string;
  models?: CodexModelChoice[];
  private native?: NativeAuth;
  private refresh?: NativeAuth;
  private finishing?: Promise<void>;
  private destroying?: Promise<void>;
  private cached?: { headers: Record<string, string>; at: number };
  private refreshing?: Promise<Record<string, string>>;

  private constructor(private readonly home: string) {}

  static async create(): Promise<CodexAccount> {
    const home = await mkdtemp(join(tmpdir(), "sw-codex-auth-"));
    await chmod(home, 0o700);
    return new CodexAccount(home);
  }

  async startLogin(): Promise<{ verificationUrl: string; userCode: string }> {
    this.native = new NativeAuth(this.home, (event) => {
      if (event.method !== "account/login/completed") return;
      if (event.params?.success) {
        this.finishing = this.finishLogin().catch((error) => {
          this.error = error instanceof CodexSafeError ? error.message : "Codex could not verify the login. Disconnect and try again.";
        });
      } else this.error = "Login was cancelled or expired. Disconnect and try again.";
    });
    await this.native.initialize();
    const result = await this.native.rpc("account/login/start", { type: "chatgptDeviceCode" }, 40_000);
    const url = new URL(String(result?.verificationUrl));
    if (url.origin !== "https://auth.openai.com" || !/^\/codex\/device\/?$/.test(url.pathname) || typeof result.userCode !== "string" || result.userCode.length > 40) {
      throw new CodexSafeError("Codex returned an unexpected login destination. Nothing was connected.");
    }
    return { verificationUrl: url.href, userCode: result.userCode };
  }

  private async finishLogin(): Promise<void> {
    const native = this.native!;
    const result = await native.rpc("account/read", { refreshToken: true });
    if (result?.account?.type !== "chatgpt") throw new CodexSafeError("A ChatGPT subscription login is required.", 401);
    await this.tokens();
    this.models = modelChoices(await discoverModels(native));
    if (this.closed) return;
    this.connected = true;
    await native.stop();
    this.native = undefined;
  }

  private async tokens(): Promise<{ access_token: string; account_id: string }> {
    const path = join(this.home, "auth.json");
    await chmod(path, 0o600);
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value?.auth_mode !== "chatgpt" || !value.tokens?.access_token || !value.tokens?.account_id) {
      throw new CodexSafeError("Your Codex connection needs attention. Disconnect and sign in again.", 401);
    }
    return value.tokens;
  }

  /** Validates a selection against the latest advertised catalog. */
  choose(selection: unknown): CodexSelection {
    if (!this.connected) throw new CodexSafeError("Connect your own Codex subscription first.", 401);
    return chooseModel(this.models, selection);
  }

  /** Request headers, refreshed through the CLI at most every five minutes. */
  async headers(): Promise<Record<string, string>> {
    if (this.closed || !this.connected) throw new CodexSafeError("Connect your own Codex subscription first.", 401);
    if (this.cached && Date.now() - this.cached.at < headerTtlMs) return this.cached.headers;
    this.refreshing ??= this.refreshHeaders().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async refreshHeaders(): Promise<Record<string, string>> {
    const native = new NativeAuth(this.home);
    this.refresh = native;
    try {
      await native.initialize();
      const result = await native.rpc("account/read", { refreshToken: true });
      if (this.closed || result?.account?.type !== "chatgpt") throw new CodexSafeError("Reconnect your Codex subscription.", 401);
      this.models = modelChoices(await discoverModels(native));
      const tokens = await this.tokens();
      const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        "ChatGPT-Account-Id": tokens.account_id,
        "OpenAI-Beta": "responses=experimental",
        originator: "stateweave_lab",
        "User-Agent": "StateWeaveLab/1.0",
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      };
      this.cached = { headers, at: Date.now() };
      return headers;
    } finally {
      await native.stop();
      this.refresh = undefined;
    }
  }

  destroy(): Promise<void> {
    if (this.destroying) return this.destroying;
    this.closed = true;
    this.connected = false;
    this.cached = undefined;
    this.destroying = (async () => {
      await Promise.all([this.native?.stop(), this.refresh?.stop()]);
      await this.finishing;
      await rm(this.home, { recursive: true, force: true });
    })();
    return this.destroying;
  }
}
