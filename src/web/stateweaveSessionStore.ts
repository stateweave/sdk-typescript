import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm, stat, truncate } from "node:fs/promises";
import path from "node:path";
import { assertValidCausalWeaveSnapshot } from "../core/causalWeave.js";
import type { CausalWeaveNode } from "../core/causalTypes.js";
import type { AgentRunMetadata, AgentState } from "../agent/types.js";
import type { SessionHistoryEntry, SessionUsageRecord, StateWeaveSessionView } from "./stateweaveSessionTypes.js";
export type { SessionHistoryEntry, SessionUsageRecord, StateWeaveSessionView } from "./stateweaveSessionTypes.js";

export const stateWeaveSessionVersion = 1;
export const maxSessionUsageRecords = 500;
export const maxSessionHistoryEntries = 400;

type SessionHeader = {
  type: "session";
  version: 1;
  sessionId: string;
  createdAt: string;
};

type BootstrapEntry = {
  type: "bootstrap";
  id: string;
  parentId: null;
  timestamp: string;
  state?: AgentState;
  usageHistory: SessionUsageRecord[];
};

type TurnCommitEntry = {
  type: "turn_commit";
  id: string;
  parentId: string | null;
  timestamp: string;
  turn: number;
  runId: string;
  input: string;
  finalAnswer: string;
  userNodeId?: string;
  assistantNodeId?: string;
  newNodes: CausalWeaveNode[];
  frontier: string[];
  stateHash: string;
  metadata: AgentRunMetadata;
};

type RunErrorEntry = {
  type: "run_error";
  id: string;
  parentId: string | null;
  attemptedParentId?: string;
  timestamp: string;
  turn: number;
  runId?: string;
  input: string;
  error: string;
  usage?: SessionUsageRecord;
};

type CheckpointEntry = {
  type: "checkpoint";
  id: string;
  parentId: string | null;
  timestamp: string;
  turnCount: number;
  interactionCount: number;
  state: AgentState;
  stateHash: string;
};

type SessionEntry = BootstrapEntry | TurnCommitEntry | RunErrorEntry | CheckpointEntry;

type LoadedSession = StateWeaveSessionView & {
  validBytes: number;
  hasPartialTail: boolean;
};

export class SessionConflictError extends Error {
  constructor(message: string, readonly currentTurnId?: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`StateWeave session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCorruptError";
  }
}

export class StateWeaveSessionStore {
  constructor(private readonly rootDir: string, private readonly checkpointEvery = 50) {}

  async create(args: { state?: AgentState; usageHistory?: unknown } = {}): Promise<StateWeaveSessionView> {
    if (args.state) assertValidCausalWeaveSnapshot(args.state);
    const usageHistory = parseUsageHistory(args.usageHistory);
    const sessionId = newSessionId();
    const header: SessionHeader = { type: "session", version: stateWeaveSessionVersion, sessionId, createdAt: new Date().toISOString() };
    const lines: string[] = [JSON.stringify(header)];
    if (args.state || usageHistory.length) {
      const bootstrap: BootstrapEntry = {
        type: "bootstrap",
        id: newEntryId(),
        parentId: null,
        timestamp: new Date().toISOString(),
        ...(args.state ? { state: structuredClone(args.state) } : {}),
        usageHistory
      };
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

  async load(sessionId: string): Promise<StateWeaveSessionView> {
    const loaded = await this.loadInternal(sessionId);
    return publicView(loaded);
  }

  async commitTurn(args: {
    sessionId: string;
    expectedParentId?: string;
    input: string;
    previousState?: AgentState;
    state: AgentState;
    finalAnswer: string;
    metadata: AgentRunMetadata;
  }): Promise<{ sessionId: string; turnId: string; turn: number; turnCount: number }> {
    assertValidCausalWeaveSnapshot(args.state);
    if (args.previousState) assertValidCausalWeaveSnapshot(args.previousState);
    return this.withLock(args.sessionId, async () => {
      const current = await this.loadInternal(args.sessionId);
      await this.repairPartialTail(args.sessionId, current);
      assertExpectedParent(current.currentTurnId, args.expectedParentId);
      assertStateMatches(current.state, args.previousState);
      const newNodes = stateDelta(current.state, args.state);
      const turn = current.interactionCount + 1;
      const turnId = newEntryId();
      const userNodeId = [...newNodes].reverse().find((node) => node.kind === "goal")?.id;
      const assistantNodeId = [...newNodes].reverse().find((node) => node.kind === "answer")?.id;
      const entry: TurnCommitEntry = {
        type: "turn_commit",
        id: turnId,
        parentId: current.currentTurnId ?? null,
        timestamp: args.metadata.completedAt,
        turn,
        runId: args.metadata.runId,
        input: args.input,
        finalAnswer: args.finalAnswer,
        ...(userNodeId ? { userNodeId } : {}),
        ...(assistantNodeId ? { assistantNodeId } : {}),
        newNodes,
        frontier: [...args.state.frontier],
        stateHash: stateHash(args.state),
        metadata: structuredClone(args.metadata)
      };
      try {
        await this.append(args.sessionId, entry);
      } catch (error) {
        const recovered = await this.loadInternal(args.sessionId).catch(() => undefined);
        if (!recovered?.state || recovered.currentTurnId !== turnId || stateHash(recovered.state) !== entry.stateHash) throw error;
      }
      const turnCount = current.turnCount + 1;
      if (this.checkpointEvery > 0 && turnCount % this.checkpointEvery === 0) {
        const checkpoint: CheckpointEntry = {
          type: "checkpoint",
          id: newEntryId(),
          parentId: turnId,
          timestamp: new Date().toISOString(),
          turnCount,
          interactionCount: turn,
          state: structuredClone(args.state),
          stateHash: stateHash(args.state)
        };
        await this.append(args.sessionId, checkpoint).catch((error) => {
          console.error(`StateWeave session checkpoint failed after committed turn ${turnId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return { sessionId: args.sessionId, turnId, turn, turnCount };
    });
  }

  async appendFailure(args: {
    sessionId: string;
    expectedParentId?: string;
    input: string;
    error: string;
    runId?: string;
    usage?: Omit<SessionUsageRecord, "turn" | "status">;
  }): Promise<{ sessionId: string; turn: number; currentTurnId?: string }> {
    return this.withLock(args.sessionId, async () => {
      const current = await this.loadInternal(args.sessionId);
      await this.repairPartialTail(args.sessionId, current);
      const turn = current.interactionCount + 1;
      const entry: RunErrorEntry = {
        type: "run_error",
        id: newEntryId(),
        parentId: current.currentTurnId ?? null,
        ...(args.expectedParentId && args.expectedParentId !== current.currentTurnId ? { attemptedParentId: args.expectedParentId } : {}),
        timestamp: new Date().toISOString(),
        turn,
        ...(args.runId ? { runId: args.runId } : {}),
        input: args.input,
        error: args.error.slice(0, 8_000),
        ...(args.usage ? { usage: { ...args.usage, turn, status: "failed" } } : {})
      };
      await this.append(args.sessionId, entry);
      return { sessionId: args.sessionId, turn, ...(current.currentTurnId ? { currentTurnId: current.currentTurnId } : {}) };
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.withLock(sessionId, async () => {
      await rm(this.sessionPath(sessionId), { force: true });
    });
  }

  private async loadInternal(sessionId: string): Promise<LoadedSession> {
    assertSessionId(sessionId);
    let buffer: Buffer;
    try {
      buffer = await readFile(this.sessionPath(sessionId));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new SessionNotFoundError(sessionId);
      throw error;
    }
    if (buffer.length > 512 * 1024 * 1024) throw new SessionCorruptError("StateWeave session exceeds the 512 MiB safety limit.");
    const parsed = parseJsonl(buffer);
    if (!parsed.records.length) throw new SessionCorruptError("StateWeave session has no header.");
    const header = parseHeader(parsed.records[0]);
    if (header.sessionId !== sessionId) throw new SessionCorruptError("StateWeave session header ID does not match its filename.");

    let state: AgentState | undefined;
    let currentTurnId: string | undefined;
    let turnCount = 0;
    let interactionCount = 0;
    let bootstrapSeen = false;
    const history: SessionHistoryEntry[] = [];
    const usageHistory: SessionUsageRecord[] = [];
    const entryIds = new Set<string>();

    for (const raw of parsed.records.slice(1)) {
      const entry = parseEntry(raw);
      if (entryIds.has(entry.id)) throw new SessionCorruptError(`Duplicate session entry ID: ${entry.id}`);
      entryIds.add(entry.id);
      if (entry.type === "bootstrap") {
        if (bootstrapSeen || currentTurnId || turnCount) throw new SessionCorruptError("Bootstrap entry must appear before committed turns.");
        bootstrapSeen = true;
        if (entry.state) {
          assertValidCausalWeaveSnapshot(entry.state);
          state = structuredClone(entry.state);
          history.push(...historyFromState(entry.state));
          turnCount = entry.state.nodes.filter((node) => node.kind === "answer").length;
        }
        usageHistory.push(...entry.usageHistory);
        interactionCount = Math.max(interactionCount, ...entry.usageHistory.map((usage) => usage.turn), history.length ? Math.ceil(history.length / 2) : 0);
        continue;
      }
      if (entry.type === "turn_commit") {
        if (entry.parentId !== (currentTurnId ?? null)) throw new SessionCorruptError(`Turn ${entry.id} does not extend the active session leaf.`);
        if (entry.turn !== interactionCount + 1) throw new SessionCorruptError(`Turn sequence mismatch at ${entry.id}.`);
        const nextState: AgentState = { version: 1, nodes: [...(state?.nodes ?? []), ...entry.newNodes], frontier: entry.frontier };
        assertValidCausalWeaveSnapshot(nextState);
        if (stateHash(nextState) !== entry.stateHash) throw new SessionCorruptError(`State hash mismatch at ${entry.id}.`);
        state = nextState;
        currentTurnId = entry.id;
        turnCount += 1;
        interactionCount = entry.turn;
        history.push(
          { role: "user", content: entry.input, turn: entry.turn, ...(entry.userNodeId ? { nodeId: entry.userNodeId } : {}) },
          { role: "assistant", content: entry.finalAnswer, turn: entry.turn, ...(entry.assistantNodeId ? { nodeId: entry.assistantNodeId } : {}) }
        );
        usageHistory.push(usageFromMetadata(entry.turn, entry.metadata));
        continue;
      }
      if (entry.type === "run_error") {
        if (entry.parentId !== (currentTurnId ?? null)) throw new SessionCorruptError(`Failed turn ${entry.id} does not reference the active session leaf.`);
        if (entry.turn !== interactionCount + 1) throw new SessionCorruptError(`Failed turn sequence mismatch at ${entry.id}.`);
        interactionCount = entry.turn;
        history.push(
          { role: "user", content: entry.input, turn: entry.turn },
          { role: "error", content: entry.error, turn: entry.turn }
        );
        if (entry.usage) usageHistory.push(entry.usage);
        continue;
      }
      if (entry.parentId !== (currentTurnId ?? null)) throw new SessionCorruptError(`Checkpoint ${entry.id} does not match the active leaf.`);
      if (entry.turnCount !== turnCount || entry.interactionCount !== interactionCount) throw new SessionCorruptError(`Checkpoint counters do not match at ${entry.id}.`);
      assertValidCausalWeaveSnapshot(entry.state);
      if (stateHash(entry.state) !== entry.stateHash || (state && stateHash(state) !== entry.stateHash)) throw new SessionCorruptError(`Checkpoint state mismatch at ${entry.id}.`);
      state = structuredClone(entry.state);
    }

    const visibleHistory = history.slice(-maxSessionHistoryEntries);
    return {
      sessionId,
      ...(currentTurnId ? { currentTurnId } : {}),
      ...(state ? { state } : {}),
      history: visibleHistory,
      historyTruncated: visibleHistory.length < history.length,
      usageHistory: usageHistory.slice(-maxSessionUsageRecords),
      turnCount,
      interactionCount,
      storage: "jsonl",
      logBytes: buffer.length,
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

  private async repairPartialTail(sessionId: string, loaded: LoadedSession): Promise<void> {
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
    if (!handle) throw new Error(`Timed out acquiring StateWeave session lock: ${sessionId}`);
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
        throw new SessionCorruptError(`Invalid complete JSONL record at byte ${offset}.`);
      }
    }
    offset = newline + 1;
    newline = buffer.indexOf(0x0a, offset);
  }
  const tail = buffer.subarray(offset).toString("utf8");
  return { records, validBytes: offset, hasPartialTail: Boolean(tail.trim()) };
}

function parseHeader(value: unknown): SessionHeader {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SessionCorruptError("Invalid StateWeave session header.");
  const header = value as Partial<SessionHeader>;
  if (header.type !== "session" || header.version !== stateWeaveSessionVersion || typeof header.sessionId !== "string" || !validTimestamp(header.createdAt)) throw new SessionCorruptError("Invalid StateWeave session header.");
  assertSessionId(header.sessionId);
  return header as SessionHeader;
}

function parseEntry(value: unknown): SessionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SessionCorruptError("Invalid StateWeave session entry.");
  const entry = value as Record<string, unknown>;
  if (!isEntryId(entry.id) || !validTimestamp(entry.timestamp)) throw new SessionCorruptError("Invalid StateWeave session entry identity.");
  if (entry.parentId !== null && !isEntryId(entry.parentId)) throw new SessionCorruptError(`Invalid parent for entry ${entry.id}.`);
  if (entry.type === "bootstrap") {
    const usageHistory = parseUsageHistory(entry.usageHistory);
    if (entry.state !== undefined && !isAgentState(entry.state)) throw new SessionCorruptError("Invalid bootstrap AgentState.");
    return { ...(entry as unknown as BootstrapEntry), usageHistory };
  }
  if (entry.type === "turn_commit") {
    if (!positiveInteger(entry.turn) || typeof entry.runId !== "string" || typeof entry.input !== "string" || typeof entry.finalAnswer !== "string" || !Array.isArray(entry.newNodes) || !Array.isArray(entry.frontier) || typeof entry.stateHash !== "string" || !isRunMetadata(entry.metadata)) throw new SessionCorruptError(`Invalid committed turn ${entry.id}.`);
    return entry as unknown as TurnCommitEntry;
  }
  if (entry.type === "run_error") {
    if (!positiveInteger(entry.turn) || typeof entry.input !== "string" || typeof entry.error !== "string") throw new SessionCorruptError(`Invalid failed turn ${entry.id}.`);
    if (entry.usage !== undefined && !isUsageRecord(entry.usage)) throw new SessionCorruptError(`Invalid failed-turn usage ${entry.id}.`);
    return entry as unknown as RunErrorEntry;
  }
  if (entry.type === "checkpoint") {
    if (!nonNegativeInteger(entry.turnCount) || !nonNegativeInteger(entry.interactionCount) || !isAgentState(entry.state) || typeof entry.stateHash !== "string") throw new SessionCorruptError(`Invalid checkpoint ${entry.id}.`);
    return entry as unknown as CheckpointEntry;
  }
  throw new SessionCorruptError(`Unsupported StateWeave session entry type: ${String(entry.type)}`);
}

function stateDelta(previous: AgentState | undefined, next: AgentState): CausalWeaveNode[] {
  const previousNodes = previous?.nodes ?? [];
  if (previousNodes.length > next.nodes.length) throw new SessionConflictError("Committed AgentState cannot remove causal nodes.");
  for (const [index, node] of previousNodes.entries()) {
    if (JSON.stringify(node) !== JSON.stringify(next.nodes[index])) throw new SessionConflictError(`Committed AgentState diverged at node ${node.id}.`);
  }
  return structuredClone(next.nodes.slice(previousNodes.length));
}

function assertStateMatches(current: AgentState | undefined, supplied: AgentState | undefined): void {
  if (!supplied && !current) return;
  if (!supplied || !current || stateHash(supplied) !== stateHash(current)) throw new SessionConflictError("The session state changed before this run could commit.");
}

function assertExpectedParent(current: string | undefined, expected: string | undefined): void {
  if ((current ?? undefined) !== (expected ?? undefined)) throw new SessionConflictError("The session advanced in another browser tab. Reload before continuing.", current);
}

function usageFromMetadata(turn: number, metadata: AgentRunMetadata): SessionUsageRecord {
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
    maxPromptTokens: metadata.maxPromptTokens,
    projectionTargetTokens: metadata.projectionTargetTokens,
    tokenCountSource: metadata.tokenCountSource,
    status: "done"
  };
}

function parseUsageHistory(value: unknown): SessionUsageRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isUsageRecord).map((record) => structuredClone(record)).slice(-maxSessionUsageRecords);
}

function isUsageRecord(value: unknown): value is SessionUsageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return positiveInteger(usage.turn)
    && typeof usage.runId === "string"
    && validTimestamp(usage.startedAt)
    && validTimestamp(usage.completedAt)
    && ["latestContextTokens", "peakContextTokens", "totalInputTokens", "outputTokens", "modelCalls", "maxPromptTokens", "projectionTargetTokens"].every((key) => nonNegativeInteger(usage[key]))
    && (usage.tokenCountSource === "provider" || usage.tokenCountSource === "estimated" || usage.tokenCountSource === "mixed")
    && (usage.status === "done" || usage.status === "failed");
}

function isRunMetadata(value: unknown): value is AgentRunMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.runId === "string"
    && metadata.engine === "causal-weave-v3"
    && validTimestamp(metadata.startedAt)
    && validTimestamp(metadata.completedAt)
    && metadata.status === "done"
    && ["latestContextTokens", "peakContextTokens", "totalInputTokens", "outputTokens", "modelCalls", "maxPromptTokens", "projectionTargetTokens"].every((key) => nonNegativeInteger(metadata[key]))
    && (metadata.tokenCountSource === "provider" || metadata.tokenCountSource === "estimated" || metadata.tokenCountSource === "mixed");
}

function isAgentState(value: unknown): value is AgentState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<AgentState>;
  return state.version === 1 && Array.isArray(state.nodes) && Array.isArray(state.frontier);
}

function historyFromState(state: AgentState): SessionHistoryEntry[] {
  const history: SessionHistoryEntry[] = [];
  let turn = 0;
  for (const node of state.nodes) {
    if (node.kind === "goal") {
      turn += 1;
      history.push({ role: "user", content: payloadText(node.payload), turn, nodeId: node.id });
    } else if (node.kind === "answer") {
      history.push({ role: "assistant", content: payloadText(node.payload), turn: Math.max(1, turn), nodeId: node.id });
    }
  }
  return history;
}

function payloadText(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

function stateHash(state: AgentState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function newSessionId(): string {
  return `sws_${randomBytes(16).toString("hex")}`;
}

function newEntryId(): string {
  return randomBytes(8).toString("hex");
}

function assertSessionId(value: string): void {
  if (!/^sws_[0-9a-f]{32}$/.test(value)) throw new Error("Invalid StateWeave session ID.");
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

function publicView(loaded: LoadedSession): StateWeaveSessionView {
  const { validBytes: _validBytes, hasPartialTail: _hasPartialTail, ...view } = loaded;
  return structuredClone(view);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
