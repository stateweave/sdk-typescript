import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentRunMetadata, AgentState } from "../src/agent/types.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import type { AgenticMessage } from "../src/evals/agenticBaseline.js";
import { DualSessionConflictError, DualSessionCorruptError, DualSessionNotFoundError, DualSessionStore } from "../src/web/dualSessionStore.js";
import type { DualUsageRecord } from "../src/web/dualSessionTypes.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

async function store(checkpointEvery = 50): Promise<{ root: string; value: DualSessionStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-dual-"));
  tempDirs.push(root);
  return { root, value: new DualSessionStore(root, checkpointEvery) };
}

function nextState(previous: AgentState | undefined, input: string, answer: string): AgentState {
  const weave = new CausalWeave(previous);
  if (!previous) weave.append({ kind: "system", payload: "system", parents: [], advance: false });
  weave.append({ kind: "goal", payload: input });
  weave.append({ kind: "answer", payload: answer });
  return weave.snapshot();
}

function metadata(runId: string, inputTokens = 100): AgentRunMetadata {
  return {
    runId, engine: "causal-weave-v3", tools: [], startedAt: "2026-08-18T12:00:00.000Z", completedAt: "2026-08-18T12:00:01.000Z", durationMs: 1000,
    maxIterations: 30, maxPromptTokens: 64_000, projectionTargetTokens: 16_000, projectionMaxNodes: 16, contextMode: "molecular", nodeTypes: [], allowDynamicNodeTypes: false,
    stepCount: 1, modelCalls: 1, toolCalls: 0, latestContextTokens: inputTokens, peakContextTokens: inputTokens, totalInputTokens: inputTokens, outputTokens: 10, tokenCountSource: "provider", status: "done"
  };
}

function usage(runId: string, compactions = 0, compactionAttempts = compactions): Omit<DualUsageRecord, "turn" | "status"> {
  return {
    runId, startedAt: "2026-08-18T12:00:00.000Z", completedAt: "2026-08-18T12:00:01.000Z", latestContextTokens: 120, peakContextTokens: 180, totalInputTokens: 220,
    outputTokens: 20, modelCalls: 1 + compactionAttempts, toolCalls: 0, maxPromptTokens: 64_000, contextTargetTokens: 30_000, tokenCountSource: "provider", compactions, compactionAttempts,
    compactionInputTokens: compactionAttempts ? 100 : 0, compactionOutputTokens: compactionAttempts ? 10 : 0, compactionModelCalls: compactionAttempts
  };
}

function messages(input: string, answer: string, summary?: string): AgenticMessage[] {
  return [
    { role: "system", content: "traditional system" },
    ...(summary ? [{ role: "assistant" as const, content: `COMPACTED TRANSCRIPT SUMMARY:\n${summary}` }] : []),
    { role: "user", content: input },
    { role: "assistant", content: `FINAL: ${answer}` }
  ];
}

it("atomically persists both arms on one paired turn", async () => {
  const { root, value } = await store();
  const created = await value.create();
  const state = nextState(undefined, "build it", "built");
  const commit = await value.commitPair({
    sessionId: created.sessionId,
    input: "build it",
    previousTraditionalMessages: [],
    stateweave: { status: "done", state, answer: "built", metadata: metadata("sw_1") },
    traditional: { status: "done", messages: messages("build it", "built traditionally"), answer: "built traditionally", usage: usage("tr_1") }
  });

  const restored = await value.load(created.sessionId);
  expect(restored).toMatchObject({ storage: "jsonl-dual", currentTurnId: commit.turnId, turnCount: 1 });
  expect(restored.stateweave.state).toEqual(state);
  expect(restored.turns[0]).toMatchObject({ input: "build it", stateweave: { status: "done", answer: "built" }, traditional: { status: "done", answer: "built traditionally" } });
  expect(restored.stateweave.usageHistory[0].totalInputTokens).toBe(100);
  expect(restored.traditional.usageHistory[0].totalInputTokens).toBe(220);
  const records = (await readFile(path.join(root, `${created.sessionId}.jsonl`), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(records.map((record) => record.type)).toEqual(["session", "paired_turn"]);
  expect(records[1].stateweave).not.toHaveProperty("state");
});

it("lists saved sessions with bounded conversation previews", async () => {
  const { value } = await store();
  const empty = await value.create();
  const active = await value.create();
  const state = nextState(undefined, "A very long first prompt ".repeat(20), "answer");
  await value.commitPair({
    sessionId: active.sessionId,
    input: "A very long first prompt ".repeat(20),
    previousTraditionalMessages: [],
    stateweave: { status: "done", state, answer: "answer", metadata: metadata("sw-list") },
    traditional: { status: "done", messages: messages("A very long first prompt ".repeat(20), "answer"), answer: "answer", usage: usage("tr-list") }
  });
  const sessions = await value.list();
  expect(sessions).toHaveLength(2);
  expect(sessions.find((session) => session.sessionId === empty.sessionId)).toMatchObject({ turnCount: 0, title: "New conversation", preview: "No messages yet" });
  const listed = sessions.find((session) => session.sessionId === active.sessionId);
  expect(listed).toMatchObject({ turnCount: 1, title: expect.stringContaining("A very long first prompt") });
  expect(listed?.title.length).toBeLessThanOrEqual(140);
  expect(listed?.preview.length).toBeLessThanOrEqual(140);
});

it("advances only the successful arm when its pair fails", async () => {
  const { value } = await store();
  const created = await value.create();
  const state = nextState(undefined, "question", "state answer");
  await value.commitPair({
    sessionId: created.sessionId, input: "question", previousTraditionalMessages: [],
    stateweave: { status: "done", state, answer: "state answer", metadata: metadata("sw") },
    traditional: { status: "failed", error: "provider unavailable", usage: usage("tr_fail") }
  });
  const restored = await value.loadForRun(created.sessionId);
  expect(restored.stateweave.state).toEqual(state);
  expect(restored.traditionalMessages).toEqual([]);
  expect(restored.turns[0]).toMatchObject({ traditional: { status: "failed", error: "provider unavailable" } });
  expect(restored.traditional.usageHistory[0].status).toBe("failed");
});

it("persists preflight maintenance when the following traditional task fails", async () => {
  const { root, value } = await store(1);
  const created = await value.create();
  const firstState = nextState(undefined, "one", "one answer");
  const firstMessages = messages("one", "one answer");
  const first = await value.commitPair({ sessionId: created.sessionId, input: "one", previousTraditionalMessages: [], stateweave: { status: "done", state: firstState, answer: "one answer", metadata: metadata("sw1") }, traditional: { status: "done", messages: firstMessages, answer: "one answer", usage: usage("tr1") } });
  const maintained: AgenticMessage[] = [
    { role: "system", content: "traditional system" },
    { role: "assistant", content: "COMPACTED TRANSCRIPT SUMMARY:\ndurable summary of turn one" }
  ];
  await value.commitPair({
    sessionId: created.sessionId,
    expectedTurnId: first.turnId,
    input: "two",
    previousState: firstState,
    previousTraditionalMessages: firstMessages,
    stateweave: { status: "failed", error: "state failed", usage: usage("sw_fail") },
    traditional: { status: "failed", error: "provider unavailable", usage: usage("tr_fail", 1, 1), maintainedMessages: maintained }
  });

  const restored = await new DualSessionStore(root, 1).loadForRun(created.sessionId);
  expect(restored.traditionalMessages).toEqual(maintained);
  expect(restored.traditional.totalCompactions).toBe(1);
  expect(restored.traditional.totalCompactionAttempts).toBe(1);
  expect(restored.turns[1]).toMatchObject({ traditional: { status: "failed", usage: { compactions: 1, compactionAttempts: 1 } } });
  const records = (await readFile(path.join(root, `${created.sessionId}.jsonl`), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(records.at(-1)).toMatchObject({ type: "checkpoint", traditionalMessages: maintained });
});

it("migrates legacy failed-turn compactions into attempts rather than committed state", async () => {
  const { root, value } = await store();
  const created = await value.create();
  await value.commitPair({ sessionId: created.sessionId, input: "one", previousTraditionalMessages: [], stateweave: { status: "failed", error: "failed", usage: usage("sw_fail") }, traditional: { status: "failed", error: "legacy failed summary", usage: usage("tr_fail", 0, 1) } });
  const file = path.join(root, `${created.sessionId}.jsonl`);
  const records = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  records[1].traditional.usage.compactions = 1;
  delete records[1].traditional.usage.compactionAttempts;
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const restored = await value.loadForRun(created.sessionId);
  expect(restored.traditional.totalCompactions).toBe(0);
  expect(restored.traditional.totalCompactionAttempts).toBe(1);
  expect(restored.turns[0]?.traditional.usage).toMatchObject({ compactions: 0, compactionAttempts: 1 });
});

it("reports an uncommitted summary attempt without changing active messages", async () => {
  const { value } = await store();
  const created = await value.create();
  const active = messages("one", "answer");
  const first = await value.commitPair({ sessionId: created.sessionId, input: "one", previousTraditionalMessages: [], stateweave: { status: "done", state: nextState(undefined, "one", "answer"), answer: "answer", metadata: metadata("sw1") }, traditional: { status: "done", messages: active, answer: "answer", usage: usage("tr1") } });
  const priorState = (await value.loadForRun(created.sessionId)).stateweave.state;
  await value.commitPair({ sessionId: created.sessionId, expectedTurnId: first.turnId, input: "two", previousState: priorState, previousTraditionalMessages: active, stateweave: { status: "failed", error: "failed", usage: usage("sw_fail") }, traditional: { status: "failed", error: "summary rejected", usage: usage("tr_fail", 0, 2) } });

  const restored = await value.loadForRun(created.sessionId);
  expect(restored.traditionalMessages).toEqual(active);
  expect(restored.traditional.totalCompactions).toBe(0);
  expect(restored.traditional.totalCompactionAttempts).toBe(2);
});

it("persists compacted active messages and compaction cost", async () => {
  const { value } = await store();
  const created = await value.create();
  const firstState = nextState(undefined, "one", "one answer");
  const firstMessages = messages("one", "one answer");
  const first = await value.commitPair({ sessionId: created.sessionId, input: "one", previousTraditionalMessages: [], stateweave: { status: "done", state: firstState, answer: "one answer", metadata: metadata("sw1") }, traditional: { status: "done", messages: firstMessages, answer: "one answer", usage: usage("tr1") } });
  const secondState = nextState(firstState, "two", "two answer");
  const compacted = messages("two", "two answer", "durable summary of turn one");
  await value.commitPair({ sessionId: created.sessionId, expectedTurnId: first.turnId, input: "two", previousState: firstState, previousTraditionalMessages: firstMessages, stateweave: { status: "done", state: secondState, answer: "two answer", metadata: metadata("sw2") }, traditional: { status: "done", messages: compacted, answer: "two answer", usage: usage("tr2", 1) } });
  const restored = await value.loadForRun(created.sessionId);
  expect(restored.traditionalMessages).toEqual(compacted);
  expect(restored.traditional.totalCompactions).toBe(1);
  expect(restored.traditional.totalCompactionAttempts).toBe(1);
  expect(restored.traditional.usageHistory[1]).toMatchObject({ compactions: 1, compactionAttempts: 1, compactionInputTokens: 100 });
  expect(restored.traditional.history.map((entry) => entry.content)).toEqual(["one", "one answer", "two", "two answer"]);
});

it("serializes concurrent paired commits and rejects one stale branch", async () => {
  const { value } = await store();
  const created = await value.create();
  const make = (label: string) => value.commitPair({ sessionId: created.sessionId, input: label, previousTraditionalMessages: [], stateweave: { status: "done" as const, state: nextState(undefined, label, label), answer: label, metadata: metadata(`sw_${label}`) }, traditional: { status: "done" as const, messages: messages(label, label), answer: label, usage: usage(`tr_${label}`) } });
  const outcomes = await Promise.allSettled([make("left"), make("right")]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: expect.any(DualSessionConflictError) });
  expect((await value.load(created.sessionId)).turnCount).toBe(1);
});

it("writes validated checkpoints for both memory primitives", async () => {
  const { root, value } = await store(1);
  const created = await value.create();
  const state = nextState(undefined, "one", "done");
  const active = messages("one", "done");
  await value.commitPair({ sessionId: created.sessionId, input: "one", previousTraditionalMessages: [], stateweave: { status: "done", state, answer: "done", metadata: metadata("sw") }, traditional: { status: "done", messages: active, answer: "done", usage: usage("tr") } });
  const records = (await readFile(path.join(root, `${created.sessionId}.jsonl`), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(records.at(-1)).toMatchObject({ type: "checkpoint", turnCount: 1, state, traditionalMessages: active });
  expect((await value.loadForRun(created.sessionId)).traditionalMessages).toEqual(active);
});

it("repairs an unterminated tail but fails closed on complete corruption", async () => {
  const { root, value } = await store();
  const created = await value.create();
  const file = path.join(root, `${created.sessionId}.jsonl`);
  await appendFile(file, '{"type":"paired_turn"');
  expect((await value.load(created.sessionId)).turnCount).toBe(0);
  const state = nextState(undefined, "one", "done");
  await value.commitPair({ sessionId: created.sessionId, input: "one", previousTraditionalMessages: [], stateweave: { status: "done", state, answer: "done", metadata: metadata("sw") }, traditional: { status: "done", messages: messages("one", "done"), answer: "done", usage: usage("tr") } });
  expect((await value.load(created.sessionId)).turnCount).toBe(1);
  await appendFile(file, "not-json\n");
  await expect(value.load(created.sessionId)).rejects.toBeInstanceOf(DualSessionCorruptError);
});

it("supports StateWeave bootstrap imports and exact deletion", async () => {
  const { value } = await store();
  const state = nextState(undefined, "legacy", "legacy answer");
  const created = await value.create({ state });
  expect(created.stateweave.state).toEqual(state);
  expect(created.turnCount).toBe(0);
  await value.delete(created.sessionId);
  await expect(value.load(created.sessionId)).rejects.toBeInstanceOf(DualSessionNotFoundError);
});
