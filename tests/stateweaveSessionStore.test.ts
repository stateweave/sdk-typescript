import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { CausalWeave } from "../src/core/causalWeave.js";
import type { AgentRunMetadata, AgentState } from "../src/agent/types.js";
import { SessionConflictError, SessionCorruptError, SessionNotFoundError, StateWeaveSessionStore } from "../src/web/stateweaveSessionStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store(checkpointEvery = 50): Promise<{ root: string; value: StateWeaveSessionStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-sessions-"));
  tempDirs.push(root);
  return { root, value: new StateWeaveSessionStore(root, checkpointEvery) };
}

function nextState(previous: AgentState | undefined, input: string, answer: string): AgentState {
  const weave = new CausalWeave(previous);
  if (!previous) weave.append({ kind: "system", payload: "system", parents: [], advance: false });
  weave.append({ kind: "goal", payload: input });
  weave.append({ kind: "answer", payload: answer });
  return weave.snapshot();
}

function metadata(runId: string, inputTokens = 100, outputTokens = 20): AgentRunMetadata {
  return {
    runId,
    engine: "causal-weave-v3",
    tools: [],
    startedAt: "2026-08-18T12:00:00.000Z",
    completedAt: "2026-08-18T12:00:01.000Z",
    durationMs: 1_000,
    maxIterations: 30,
    maxPromptTokens: 64_000,
    projectionTargetTokens: 16_000,
    projectionMaxNodes: 16,
    contextMode: "molecular",
    nodeTypes: [{ name: "memory", description: "memory" }],
    allowDynamicNodeTypes: false,
    stepCount: 1,
    modelCalls: 1,
    toolCalls: 0,
    latestContextTokens: inputTokens,
    peakContextTokens: inputTokens,
    totalInputTokens: inputTokens,
    outputTokens,
    tokenCountSource: "provider",
    status: "done"
  };
}

it("persists causal deltas and reconstructs a durable JSONL session", async () => {
  const { root, value } = await store();
  const created = await value.create();
  const firstState = nextState(undefined, "Remember Kyoto", "Stored Kyoto");
  const first = await value.commitTurn({
    sessionId: created.sessionId,
    input: "Remember Kyoto",
    state: firstState,
    finalAnswer: "Stored Kyoto",
    metadata: metadata("run_1")
  });
  const secondState = nextState(firstState, "What city?", "Kyoto");
  await value.commitTurn({
    sessionId: created.sessionId,
    expectedParentId: first.turnId,
    input: "What city?",
    previousState: firstState,
    state: secondState,
    finalAnswer: "Kyoto",
    metadata: metadata("run_2", 140, 5)
  });

  const restored = await value.load(created.sessionId);
  expect(restored.storage).toBe("jsonl");
  expect(restored.state).toEqual(secondState);
  expect(restored.turnCount).toBe(2);
  expect(restored.interactionCount).toBe(2);
  expect(restored.history.map(({ role, content }) => ({ role, content }))).toEqual([
    { role: "user", content: "Remember Kyoto" },
    { role: "assistant", content: "Stored Kyoto" },
    { role: "user", content: "What city?" },
    { role: "assistant", content: "Kyoto" }
  ]);
  expect(restored.usageHistory.map((usage) => usage.totalInputTokens)).toEqual([100, 140]);

  const file = await readFile(path.join(root, `${created.sessionId}.jsonl`), "utf8");
  const records = file.trim().split("\n").map((line) => JSON.parse(line));
  expect(records.map((record) => record.type)).toEqual(["session", "turn_commit", "turn_commit"]);
  expect(records[1].newNodes).toHaveLength(firstState.nodes.length);
  expect(records[2].newNodes).toHaveLength(secondState.nodes.length - firstState.nodes.length);
  expect(records[2]).not.toHaveProperty("state");
  expect(file.endsWith("\n")).toBe(true);
});

it("writes and validates periodic full checkpoints", async () => {
  const { root, value } = await store(2);
  const created = await value.create();
  const firstState = nextState(undefined, "one", "one done");
  const first = await value.commitTurn({ sessionId: created.sessionId, input: "one", state: firstState, finalAnswer: "one done", metadata: metadata("run_1") });
  const secondState = nextState(firstState, "two", "two done");
  await value.commitTurn({ sessionId: created.sessionId, expectedParentId: first.turnId, input: "two", previousState: firstState, state: secondState, finalAnswer: "two done", metadata: metadata("run_2") });

  const records = (await readFile(path.join(root, `${created.sessionId}.jsonl`), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(records.at(-1)).toMatchObject({ type: "checkpoint", turnCount: 2, interactionCount: 2, state: secondState });
  expect((await value.load(created.sessionId)).state).toEqual(secondState);
});

it("serializes concurrent commits and accepts exactly one branch", async () => {
  const { value } = await store();
  const created = await value.create();
  const leftState = nextState(undefined, "left", "left done");
  const rightState = nextState(undefined, "right", "right done");

  const outcomes = await Promise.allSettled([
    value.commitTurn({ sessionId: created.sessionId, input: "left", state: leftState, finalAnswer: "left done", metadata: metadata("run_left") }),
    value.commitTurn({ sessionId: created.sessionId, input: "right", state: rightState, finalAnswer: "right done", metadata: metadata("run_right") })
  ]);

  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: expect.any(SessionConflictError) });
  expect((await value.load(created.sessionId)).turnCount).toBe(1);
});

it("rejects stale writers before committing divergent state", async () => {
  const { value } = await store();
  const created = await value.create();
  const state = nextState(undefined, "one", "done");
  const committed = await value.commitTurn({ sessionId: created.sessionId, input: "one", state, finalAnswer: "done", metadata: metadata("run_1") });
  const divergent = nextState(state, "stale", "stale done");

  await expect(value.commitTurn({
    sessionId: created.sessionId,
    expectedParentId: "aaaaaaaaaaaaaaaa",
    input: "stale",
    previousState: state,
    state: divergent,
    finalAnswer: "stale done",
    metadata: metadata("run_stale")
  })).rejects.toBeInstanceOf(SessionConflictError);

  expect((await value.load(created.sessionId)).currentTurnId).toBe(committed.turnId);
});

it("records failed turns and usage without advancing committed state", async () => {
  const { value } = await store();
  const state = nextState(undefined, "one", "done");
  const created = await value.create({ state });
  const before = await value.load(created.sessionId);
  await value.appendFailure({
    sessionId: created.sessionId,
    input: "broken turn",
    error: "provider unavailable",
    runId: "run_error",
    usage: {
      runId: "run_error",
      startedAt: "2026-08-18T12:00:00.000Z",
      completedAt: "2026-08-18T12:00:01.000Z",
      latestContextTokens: 90,
      peakContextTokens: 90,
      totalInputTokens: 90,
      outputTokens: 3,
      modelCalls: 1,
      maxPromptTokens: 64_000,
      projectionTargetTokens: 16_000,
      tokenCountSource: "provider"
    }
  });

  const after = await value.load(created.sessionId);
  expect(after.state).toEqual(state);
  expect(after.currentTurnId).toBe(before.currentTurnId);
  expect(after.history.slice(-2).map((entry) => entry.role)).toEqual(["user", "error"]);
  expect(after.usageHistory.at(-1)).toMatchObject({ status: "failed", totalInputTokens: 90 });
});

it("ignores and repairs an unterminated tail before the next commit", async () => {
  const { root, value } = await store();
  const created = await value.create();
  const firstState = nextState(undefined, "one", "done");
  const first = await value.commitTurn({ sessionId: created.sessionId, input: "one", state: firstState, finalAnswer: "done", metadata: metadata("run_1") });
  const file = path.join(root, `${created.sessionId}.jsonl`);
  await appendFile(file, '{"type":"turn_commit"');

  expect((await value.load(created.sessionId)).state).toEqual(firstState);
  const secondState = nextState(firstState, "two", "done two");
  await value.commitTurn({ sessionId: created.sessionId, expectedParentId: first.turnId, input: "two", previousState: firstState, state: secondState, finalAnswer: "done two", metadata: metadata("run_2") });

  const content = await readFile(file, "utf8");
  expect(content).not.toContain('{"type":"turn_commit"{"type"');
  expect((await value.load(created.sessionId)).state).toEqual(secondState);
});

it("fails closed on a corrupt complete JSONL record", async () => {
  const { root, value } = await store();
  const created = await value.create();
  await appendFile(path.join(root, `${created.sessionId}.jsonl`), "not-json\n");
  await expect(value.load(created.sessionId)).rejects.toBeInstanceOf(SessionCorruptError);
});

it("imports a validated browser state once and deletes exact sessions", async () => {
  const { value } = await store();
  const state = nextState(undefined, "legacy", "legacy answer");
  const created = await value.create({ state, usageHistory: [{
    turn: 1,
    runId: "legacy_run",
    startedAt: "2026-08-18T12:00:00.000Z",
    completedAt: "2026-08-18T12:00:01.000Z",
    latestContextTokens: 50,
    peakContextTokens: 50,
    totalInputTokens: 50,
    outputTokens: 5,
    modelCalls: 1,
    maxPromptTokens: 64_000,
    projectionTargetTokens: 16_000,
    tokenCountSource: "provider",
    status: "done"
  }] });

  expect(created.state).toEqual(state);
  expect(created.history.map((entry) => entry.content)).toEqual(["legacy", "legacy answer"]);
  expect(created.usageHistory).toHaveLength(1);
  await value.delete(created.sessionId);
  await expect(value.load(created.sessionId)).rejects.toBeInstanceOf(SessionNotFoundError);
});
