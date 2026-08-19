import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat, truncate } from "node:fs/promises";
import path from "node:path";
import type { AgentRunMetadata, AgentState } from "../agent/types.js";
import type { CausalWeaveNode } from "../core/causalTypes.js";
import { assertValidCausalWeaveSnapshot } from "../core/causalWeave.js";
import { serializeAgenticMessages, type AgenticMessage } from "../evals/agenticBaseline.js";
import type { DualArmHistoryEntry, DualSessionSummary, DualSessionView, DualTurnView, DualUsageRecord, LoadedDualSession } from "./dualSessionTypes.js";
export type { DualSessionSummary, DualSessionView, DualUsageRecord } from "./dualSessionTypes.js";

const sessionVersion = 1;
const maxLogBytes = 512 * 1024 * 1024;
const maxHistoryEntries = 400;
const maxUsageRecords = 500;
const maxTurnViews = 200;

export type StateWeavePairOutcome =
  | { status: "done"; state: AgentState; answer: string; metadata: AgentRunMetadata }
  | { status: "failed"; error: string; usage?: Omit<DualUsageRecord, "turn" | "status"> };

export type TraditionalPairOutcome =
  | { status: "done"; messages: AgenticMessage[]; answer: string; usage: Omit<DualUsageRecord, "turn" | "status"> }
  | { status: "failed"; error: string; usage?: Omit<DualUsageRecord, "turn" | "status"> };

type SessionHeader = { type: "session"; version: 1; sessionId: string; createdAt: string };
type BootstrapEntry = { type: "bootstrap"; id: string; parentId: null; timestamp: string; state?: AgentState; stateHash?: string };
type StoredDoneStateWeave = { status: "done"; answer: string; newNodes: CausalWeaveNode[]; frontier: string[]; stateHash: string; usage: DualUsageRecord };
type StoredFailedArm = { status: "failed"; error: string; usage?: DualUsageRecord };
type StoredDoneTraditional = { status: "done"; answer: string; messages: AgenticMessage[]; messagesHash: string; usage: DualUsageRecord };
type PairEntry = {
  type: "paired_turn";
  id: string;
  parentId: string | null;
  timestamp: string;
  turn: number;
  input: string;
  stateweave: StoredDoneStateWeave | StoredFailedArm;
  traditional: StoredDoneTraditional | StoredFailedArm;
};
type CheckpointEntry = {
  type: "checkpoint";
  id: string;
  parentId: string;
  timestamp: string;
  turnCount: number;
  state?: AgentState;
  stateHash?: string;
  traditionalMessages: AgenticMessage[];
  traditionalMessagesHash: string;
};
type SessionEntry = BootstrapEntry | PairEntry | CheckpointEntry;

export class DualSessionConflictError extends Error {
  constructor(message: string, readonly currentTurnId?: string) {
    super(message);
    this.name = "DualSessionConflictError";
  }
}

export class DualSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Dual session not found: ${sessionId}`);
    this.name = "DualSessionNotFoundError";
  }
}

export class DualSessionCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DualSessionCorruptError";
  }
}

export class DualSessionStore {
  constructor(private readonly rootDir: string, private readonly checkpointEvery = 50) {}

  async create(args: { state?: AgentState } = {}): Promise<DualSessionView> {
    if (args.state) assertValidCausalWeaveSnapshot(args.state);
    const sessionId = newSessionId();
    const now = new Date().toISOString();
    const header: SessionHeader = { type: "session", version: sessionVersion, sessionId, createdAt: now };
    const lines = [JSON.stringify(header)];
    if (args.state) {
      const bootstrap: BootstrapEntry = { type: "bootstrap", id: newEntryId(), parentId: null, timestamp: now, state: structuredClone(args.state), stateHash: stateHash(args.state) };
      lines.push(JSON.stringify(bootstrap));
    }
    await this.ensureRoot();
    const handle = await open(this.sessionPath(sessionId), "wx", 0o600);
    try {
      await handle.writeFile(`${lines.join("\n")}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return this.load(sessionId);
  }

  async load(sessionId: string): Promise<DualSessionView> {
    return publicView(await this.loadInternal(sessionId));
  }

  async list(limit = 50): Promise<DualSessionSummary[]> {
    await this.ensureRoot();
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^swd_[0-9a-f]{32}\.jsonl$/.test(entry.name))
      .map(async (entry) => {
        const sessionId = entry.name.slice(0, -".jsonl".length);
        const file = path.join(this.rootDir, entry.name);
        const fileStat = await stat(file).catch(() => undefined);
        return fileStat ? { sessionId, updatedAt: new Date(fileStat.mtimeMs).toISOString(), createdAt: new Date(fileStat.birthtimeMs || fileStat.ctimeMs || fileStat.mtimeMs).toISOString() } : undefined;
      }));
    const summaries: DualSessionSummary[] = [];
    for (const candidate of candidates.filter((value): value is NonNullable<typeof value> => Boolean(value)).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, Math.max(1, Math.min(limit, 100)))) {
      try {
        const session = await this.load(candidate.sessionId);
        const lastInput = session.turns.at(-1)?.input;
        summaries.push({
          sessionId: session.sessionId,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
          turnCount: session.turnCount,
          title: session.turns.length ? boundedSessionText(session.turns[0].input) : "New conversation",
          preview: lastInput ? boundedSessionText(lastInput) : "No messages yet"
        });
      } catch {
        // Corrupt or concurrently deleted sessions stay fail-closed and out of the picker.
      }
    }
    return summaries;
  }

  async loadForRun(sessionId: string): Promise<LoadedDualSession> {
    return this.loadInternal(sessionId);
  }

  async commitPair(args: {
    sessionId: string;
    expectedTurnId?: string;
    input: string;
    previousState?: AgentState;
    previousTraditionalMessages: AgenticMessage[];
    stateweave: StateWeavePairOutcome;
    traditional: TraditionalPairOutcome;
  }): Promise<{ sessionId: string; turnId: string; turn: number; storage: "jsonl-dual" }> {
    if (args.stateweave.status === "done") assertValidCausalWeaveSnapshot(args.stateweave.state);
    assertMessages(args.previousTraditionalMessages);
    if (args.traditional.status === "done") assertMessages(args.traditional.messages);
    return this.withLock(args.sessionId, async () => {
      const current = await this.loadInternal(args.sessionId);
      await this.repairPartialTail(args.sessionId, current);
      assertExpectedParent(current.currentTurnId, args.expectedTurnId);
      assertStateMatches(current.stateweave.state, args.previousState);
      if (messagesHash(current.traditionalMessages) !== messagesHash(args.previousTraditionalMessages)) throw new DualSessionConflictError("Traditional transcript changed before this paired turn could commit.", current.currentTurnId);
      const turn = current.turnCount + 1;
      const turnId = newEntryId();
      const entry: PairEntry = {
        type: "paired_turn",
        id: turnId,
        parentId: current.currentTurnId ?? null,
        timestamp: new Date().toISOString(),
        turn,
        input: args.input,
        stateweave: storeStateWeaveOutcome(turn, current.stateweave.state, args.stateweave),
        traditional: storeTraditionalOutcome(turn, args.traditional)
      };
      try {
        await this.append(args.sessionId, entry);
      } catch (error) {
        const recovered = await this.loadInternal(args.sessionId).catch(() => undefined);
        if (recovered?.currentTurnId !== turnId) throw error;
      }
      if (this.checkpointEvery > 0 && turn % this.checkpointEvery === 0) {
        const state = args.stateweave.status === "done" ? args.stateweave.state : current.stateweave.state;
        const traditionalMessages = args.traditional.status === "done" ? args.traditional.messages : current.traditionalMessages;
        const checkpoint: CheckpointEntry = {
          type: "checkpoint",
          id: newEntryId(),
          parentId: turnId,
          timestamp: new Date().toISOString(),
          turnCount: turn,
          ...(state ? { state: structuredClone(state), stateHash: stateHash(state) } : {}),
          traditionalMessages: structuredClone(traditionalMessages),
          traditionalMessagesHash: messagesHash(traditionalMessages)
        };
        await this.append(args.sessionId, checkpoint).catch((error) => {
          console.error(`Dual session checkpoint failed after committed turn ${turnId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return { sessionId: args.sessionId, turnId, turn, storage: "jsonl-dual" };
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.withLock(sessionId, async () => {
      await rm(this.sessionPath(sessionId), { force: true });
    });
  }

  private async loadInternal(sessionId: string): Promise<LoadedDualSession> {
    assertSessionId(sessionId);
    let buffer: Buffer;
    try {
      buffer = await readFile(this.sessionPath(sessionId));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new DualSessionNotFoundError(sessionId);
      throw error;
    }
    if (buffer.length > maxLogBytes) throw new DualSessionCorruptError("Dual session exceeds the 512 MiB safety limit.");
    const parsed = parseJsonl(buffer);
    if (!parsed.records.length) throw new DualSessionCorruptError("Dual session has no header.");
    const header = parseHeader(parsed.records[0]);
    if (header.sessionId !== sessionId) throw new DualSessionCorruptError("Dual session header ID does not match its filename.");

    let state: AgentState | undefined;
    let traditionalMessages: AgenticMessage[] = [];
    let currentTurnId: string | undefined;
    let turnCount = 0;
    let bootstrapSeen = false;
    const stateHistory: DualArmHistoryEntry[] = [];
    const traditionalHistory: DualArmHistoryEntry[] = [];
    const stateUsage: DualUsageRecord[] = [];
    const traditionalUsage: DualUsageRecord[] = [];
    const turns: DualTurnView[] = [];
    const entryIds = new Set<string>();

    for (const raw of parsed.records.slice(1)) {
      const entry = parseEntry(raw);
      if (entryIds.has(entry.id)) throw new DualSessionCorruptError(`Duplicate dual session entry ID: ${entry.id}`);
      entryIds.add(entry.id);
      if (entry.type === "bootstrap") {
        if (bootstrapSeen || currentTurnId || turnCount) throw new DualSessionCorruptError("Bootstrap must precede paired turns.");
        bootstrapSeen = true;
        if (entry.state) {
          assertValidCausalWeaveSnapshot(entry.state);
          if (stateHash(entry.state) !== entry.stateHash) throw new DualSessionCorruptError("Bootstrap state hash mismatch.");
          state = structuredClone(entry.state);
        }
        continue;
      }
      if (entry.type === "paired_turn") {
        if (entry.parentId !== (currentTurnId ?? null)) throw new DualSessionCorruptError(`Paired turn ${entry.id} does not extend the active leaf.`);
        if (entry.turn !== turnCount + 1) throw new DualSessionCorruptError(`Paired turn sequence mismatch at ${entry.id}.`);
        assertArmUsage(entry.stateweave, entry.turn, "StateWeave");
        assertArmUsage(entry.traditional, entry.turn, "Traditional");
        if (entry.stateweave.status === "done") {
          const nextState: AgentState = { version: 1, nodes: [...(state?.nodes ?? []), ...entry.stateweave.newNodes], frontier: entry.stateweave.frontier };
          assertValidCausalWeaveSnapshot(nextState);
          if (stateHash(nextState) !== entry.stateweave.stateHash) throw new DualSessionCorruptError(`StateWeave hash mismatch at ${entry.id}.`);
          state = nextState;
          stateHistory.push({ role: "user", content: entry.input, turn: entry.turn }, { role: "assistant", content: entry.stateweave.answer, turn: entry.turn });
          stateUsage.push(entry.stateweave.usage);
        } else {
          stateHistory.push({ role: "user", content: entry.input, turn: entry.turn }, { role: "error", content: entry.stateweave.error, turn: entry.turn });
          if (entry.stateweave.usage) stateUsage.push(entry.stateweave.usage);
        }
        if (entry.traditional.status === "done") {
          assertMessages(entry.traditional.messages);
          if (messagesHash(entry.traditional.messages) !== entry.traditional.messagesHash) throw new DualSessionCorruptError(`Traditional transcript hash mismatch at ${entry.id}.`);
          traditionalMessages = structuredClone(entry.traditional.messages);
          traditionalHistory.push({ role: "user", content: entry.input, turn: entry.turn }, { role: "assistant", content: entry.traditional.answer, turn: entry.turn });
          traditionalUsage.push(entry.traditional.usage);
        } else {
          traditionalHistory.push({ role: "user", content: entry.input, turn: entry.turn }, { role: "error", content: entry.traditional.error, turn: entry.turn });
          if (entry.traditional.usage) traditionalUsage.push(entry.traditional.usage);
        }
        turns.push(turnView(entry));
        currentTurnId = entry.id;
        turnCount = entry.turn;
        continue;
      }
      if (entry.parentId !== currentTurnId || entry.turnCount !== turnCount) throw new DualSessionCorruptError(`Checkpoint ${entry.id} does not match the active leaf.`);
      if (entry.state) {
        assertValidCausalWeaveSnapshot(entry.state);
        if (stateHash(entry.state) !== entry.stateHash || (state && stateHash(state) !== entry.stateHash)) throw new DualSessionCorruptError(`Checkpoint StateWeave mismatch at ${entry.id}.`);
        state = structuredClone(entry.state);
      } else if (state || entry.stateHash) {
        throw new DualSessionCorruptError(`Checkpoint StateWeave presence mismatch at ${entry.id}.`);
      }
      assertMessages(entry.traditionalMessages);
      if (messagesHash(entry.traditionalMessages) !== entry.traditionalMessagesHash || messagesHash(traditionalMessages) !== entry.traditionalMessagesHash) throw new DualSessionCorruptError(`Checkpoint traditional transcript mismatch at ${entry.id}.`);
      traditionalMessages = structuredClone(entry.traditionalMessages);
    }

    const visibleTurns = turns.slice(-maxTurnViews);
    const visibleStateHistory = stateHistory.slice(-maxHistoryEntries);
    const visibleTraditionalHistory = traditionalHistory.slice(-maxHistoryEntries);
    return {
      sessionId,
      ...(currentTurnId ? { currentTurnId } : {}),
      turnCount,
      storage: "jsonl-dual",
      stateweave: { ...(state ? { state } : {}), history: visibleStateHistory, usageHistory: stateUsage.slice(-maxUsageRecords) },
      traditional: {
        history: visibleTraditionalHistory,
        usageHistory: traditionalUsage.slice(-maxUsageRecords),
        activeMessageCount: traditionalMessages.length,
        activeContext: traditionalMessages.length ? serializeAgenticMessages(traditionalMessages) : "No traditional transcript yet.",
        totalCompactions: traditionalUsage.reduce((total, usage) => total + usage.compactions, 0)
      },
      turns: visibleTurns,
      historyTruncated: visibleTurns.length < turns.length || visibleStateHistory.length < stateHistory.length || visibleTraditionalHistory.length < traditionalHistory.length,
      logBytes: buffer.length,
      traditionalMessages,
      validBytes: parsed.validBytes,
      hasPartialTail: parsed.hasPartialTail
    };
  }

  private async append(sessionId: string, entry: SessionEntry): Promise<void> {
    const handle = await open(this.sessionPath(sessionId), "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async repairPartialTail(sessionId: string, loaded: LoadedDualSession): Promise<void> {
    if (loaded.hasPartialTail) await truncate(this.sessionPath(sessionId), loaded.validBytes);
  }

  private async withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    assertSessionId(sessionId);
    await this.ensureRoot();
    const lockPath = `${this.sessionPath(sessionId)}.lock`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        const lockStat = await stat(lockPath).catch(() => undefined);
        if (lockStat && Date.now() - lockStat.mtimeMs > 60_000) await rm(lockPath, { force: true });
        else await delay(25);
      }
    }
    if (!handle) throw new Error(`Timed out acquiring dual session lock: ${sessionId}`);
    try {
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true });
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  private sessionPath(sessionId: string): string {
    assertSessionId(sessionId);
    return path.join(this.rootDir, `${sessionId}.jsonl`);
  }
}

function storeStateWeaveOutcome(turn: number, previous: AgentState | undefined, outcome: StateWeavePairOutcome): StoredDoneStateWeave | StoredFailedArm {
  if (outcome.status === "failed") return { status: "failed", error: boundedError(outcome.error), ...(outcome.usage ? { usage: { ...outcome.usage, turn, status: "failed" } } : {}) };
  const newNodes = stateDelta(previous, outcome.state);
  return {
    status: "done",
    answer: outcome.answer,
    newNodes,
    frontier: [...outcome.state.frontier],
    stateHash: stateHash(outcome.state),
    usage: stateWeaveUsage(turn, outcome.metadata)
  };
}

function storeTraditionalOutcome(turn: number, outcome: TraditionalPairOutcome): StoredDoneTraditional | StoredFailedArm {
  if (outcome.status === "failed") return { status: "failed", error: boundedError(outcome.error), ...(outcome.usage ? { usage: { ...outcome.usage, turn, status: "failed" } } : {}) };
  return {
    status: "done",
    answer: outcome.answer,
    messages: structuredClone(outcome.messages),
    messagesHash: messagesHash(outcome.messages),
    usage: { ...outcome.usage, turn, status: "done" }
  };
}

function stateWeaveUsage(turn: number, metadata: AgentRunMetadata): DualUsageRecord {
  return {
    turn,
    runId: metadata.runId,
    startedAt: metadata.startedAt,
    completedAt: metadata.completedAt,
    latestContextTokens: metadata.latestContextTokens,
    peakContextTokens: metadata.peakContextTokens,
    totalInputTokens: metadata.totalInputTokens,
    outputTokens: metadata.outputTokens,
    modelCalls: metadata.modelCalls,
    toolCalls: metadata.toolCalls,
    maxPromptTokens: metadata.maxPromptTokens,
    contextTargetTokens: metadata.projectionTargetTokens,
    tokenCountSource: metadata.tokenCountSource,
    status: "done",
    compactions: 0,
    compactionInputTokens: 0,
    compactionOutputTokens: 0,
    compactionModelCalls: 0
  };
}

function turnView(entry: PairEntry): DualTurnView {
  const arm = (value: PairEntry["stateweave"] | PairEntry["traditional"]) => value.status === "done"
    ? { status: "done" as const, answer: value.answer, usage: value.usage }
    : { status: "failed" as const, error: value.error, ...(value.usage ? { usage: value.usage } : {}) };
  return { turn: entry.turn, turnId: entry.id, input: entry.input, timestamp: entry.timestamp, stateweave: arm(entry.stateweave), traditional: arm(entry.traditional) };
}

function parseJsonl(buffer: Buffer): { records: unknown[]; validBytes: number; hasPartialTail: boolean } {
  const records: unknown[] = [];
  let offset = 0;
  let newline = buffer.indexOf(0x0a, offset);
  while (newline >= 0) {
    const line = buffer.subarray(offset, newline).toString("utf8").trim();
    if (line) {
      try {
        records.push(JSON.parse(line));
      } catch {
        throw new DualSessionCorruptError(`Invalid complete JSONL record at byte ${offset}.`);
      }
    }
    offset = newline + 1;
    newline = buffer.indexOf(0x0a, offset);
  }
  return { records, validBytes: offset, hasPartialTail: Boolean(buffer.subarray(offset).toString("utf8").trim()) };
}

function parseHeader(value: unknown): SessionHeader {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DualSessionCorruptError("Invalid dual session header.");
  const header = value as Partial<SessionHeader>;
  if (header.type !== "session" || header.version !== sessionVersion || typeof header.sessionId !== "string" || !validTimestamp(header.createdAt)) throw new DualSessionCorruptError("Invalid dual session header.");
  assertSessionId(header.sessionId);
  return header as SessionHeader;
}

function parseEntry(value: unknown): SessionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DualSessionCorruptError("Invalid dual session entry.");
  const entry = value as Record<string, unknown>;
  if (!isEntryId(entry.id) || !validTimestamp(entry.timestamp)) throw new DualSessionCorruptError("Invalid dual session entry identity.");
  if (entry.parentId !== null && !isEntryId(entry.parentId)) throw new DualSessionCorruptError(`Invalid parent for entry ${entry.id}.`);
  if (entry.type === "bootstrap") {
    if (entry.state !== undefined && !isAgentState(entry.state)) throw new DualSessionCorruptError("Invalid bootstrap AgentState.");
    if (entry.state !== undefined && typeof entry.stateHash !== "string") throw new DualSessionCorruptError("Missing bootstrap state hash.");
    return entry as unknown as BootstrapEntry;
  }
  if (entry.type === "paired_turn") {
    if (!positiveInteger(entry.turn) || typeof entry.input !== "string" || !isStoredStateArm(entry.stateweave) || !isStoredTraditionalArm(entry.traditional)) throw new DualSessionCorruptError(`Invalid paired turn ${entry.id}.`);
    return entry as unknown as PairEntry;
  }
  if (entry.type === "checkpoint") {
    if (!positiveInteger(entry.turnCount) || !Array.isArray(entry.traditionalMessages) || typeof entry.traditionalMessagesHash !== "string") throw new DualSessionCorruptError(`Invalid checkpoint ${entry.id}.`);
    if (entry.state !== undefined && (!isAgentState(entry.state) || typeof entry.stateHash !== "string")) throw new DualSessionCorruptError(`Invalid checkpoint state ${entry.id}.`);
    return entry as unknown as CheckpointEntry;
  }
  throw new DualSessionCorruptError(`Unsupported dual session entry type: ${String(entry.type)}`);
}

function assertArmUsage(arm: StoredDoneStateWeave | StoredDoneTraditional | StoredFailedArm, turn: number, label: string): void {
  if (!arm.usage) return;
  if (arm.usage.turn !== turn || arm.usage.status !== arm.status) throw new DualSessionCorruptError(`${label} usage does not match paired turn ${turn}.`);
}

function isStoredStateArm(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const arm = value as Record<string, unknown>;
  if (arm.status === "failed") return typeof arm.error === "string" && (arm.usage === undefined || isUsage(arm.usage));
  return arm.status === "done" && typeof arm.answer === "string" && Array.isArray(arm.newNodes) && Array.isArray(arm.frontier) && typeof arm.stateHash === "string" && isUsage(arm.usage);
}

function isStoredTraditionalArm(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const arm = value as Record<string, unknown>;
  if (arm.status === "failed") return typeof arm.error === "string" && (arm.usage === undefined || isUsage(arm.usage));
  return arm.status === "done" && typeof arm.answer === "string" && Array.isArray(arm.messages) && typeof arm.messagesHash === "string" && isUsage(arm.usage);
}

function isUsage(value: unknown): value is DualUsageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return positiveInteger(usage.turn)
    && typeof usage.runId === "string"
    && validTimestamp(usage.startedAt)
    && validTimestamp(usage.completedAt)
    && ["latestContextTokens", "peakContextTokens", "totalInputTokens", "outputTokens", "modelCalls", "toolCalls", "maxPromptTokens", "contextTargetTokens", "compactions", "compactionInputTokens", "compactionOutputTokens", "compactionModelCalls"].every((key) => nonNegativeInteger(usage[key]))
    && (usage.tokenCountSource === "provider" || usage.tokenCountSource === "estimated" || usage.tokenCountSource === "mixed")
    && (usage.status === "done" || usage.status === "failed");
}

function stateDelta(previous: AgentState | undefined, next: AgentState): CausalWeaveNode[] {
  const previousNodes = previous?.nodes ?? [];
  if (previousNodes.length > next.nodes.length) throw new DualSessionConflictError("Committed AgentState cannot remove causal nodes.");
  for (const [index, node] of previousNodes.entries()) {
    if (JSON.stringify(node) !== JSON.stringify(next.nodes[index])) throw new DualSessionConflictError(`Committed AgentState diverged at node ${node.id}.`);
  }
  return structuredClone(next.nodes.slice(previousNodes.length));
}

function assertStateMatches(current: AgentState | undefined, supplied: AgentState | undefined): void {
  if (!current && !supplied) return;
  if (!current || !supplied || stateHash(current) !== stateHash(supplied)) throw new DualSessionConflictError("StateWeave state changed before this paired turn could commit.");
}

function assertExpectedParent(current: string | undefined, expected: string | undefined): void {
  if (current !== expected) throw new DualSessionConflictError("The paired session advanced in another browser tab. Reload before continuing.", current);
}

function assertMessages(messages: AgenticMessage[]): void {
  if (!Array.isArray(messages) || messages.some((message) => !message || !["system", "user", "assistant", "tool"].includes(message.role) || typeof message.content !== "string")) throw new DualSessionCorruptError("Invalid traditional transcript messages.");
}

function messagesHash(messages: AgenticMessage[]): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

function stateHash(state: AgentState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function isAgentState(value: unknown): value is AgentState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<AgentState>;
  return state.version === 1 && Array.isArray(state.nodes) && Array.isArray(state.frontier);
}

function boundedError(value: string): string {
  return value.slice(0, 8_000);
}

function boundedSessionText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 137)}…` : normalized;
}

function newSessionId(): string {
  return `swd_${randomBytes(16).toString("hex")}`;
}

function newEntryId(): string {
  return randomBytes(8).toString("hex");
}

function assertSessionId(value: string): void {
  if (!/^swd_[0-9a-f]{32}$/.test(value)) throw new Error("Invalid dual session ID.");
}

function isEntryId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

function publicView(loaded: LoadedDualSession): DualSessionView {
  const { traditionalMessages: _traditionalMessages, validBytes: _validBytes, hasPartialTail: _hasPartialTail, ...view } = loaded;
  return structuredClone(view);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
