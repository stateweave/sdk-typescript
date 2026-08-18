import type { AgentState, TokenCountSource } from "../agent/types.js";

export type SessionUsageRecord = {
  turn: number;
  runId: string;
  startedAt: string;
  completedAt: string;
  latestContextTokens: number;
  peakContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  modelCalls: number;
  maxPromptTokens: number;
  projectionTargetTokens: number;
  tokenCountSource: TokenCountSource;
  status: "done" | "failed";
};

export type SessionHistoryEntry = {
  role: "user" | "assistant" | "error";
  content: string;
  turn: number;
  nodeId?: string;
};

export type StateWeaveSessionView = {
  sessionId: string;
  currentTurnId?: string;
  state?: AgentState;
  history: SessionHistoryEntry[];
  historyTruncated: boolean;
  usageHistory: SessionUsageRecord[];
  turnCount: number;
  interactionCount: number;
  storage: "jsonl";
  logBytes: number;
};
