import type { AgentState, TokenCountSource } from "../agent/types.js";
import type { AgenticMessage } from "../evals/agenticBaseline.js";

export type DualArm = "stateweave" | "traditional";
export type DualArmStatus = "done" | "failed";

export type DualUsageRecord = {
  turn: number;
  runId: string;
  startedAt: string;
  completedAt: string;
  latestContextTokens: number;
  peakContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  modelCalls: number;
  toolCalls: number;
  maxPromptTokens: number;
  contextTargetTokens: number;
  tokenCountSource: TokenCountSource;
  status: DualArmStatus;
  compactions: number;
  compactionInputTokens: number;
  compactionOutputTokens: number;
  compactionModelCalls: number;
};

export type DualArmTurnView = {
  status: DualArmStatus;
  answer?: string;
  error?: string;
  usage?: DualUsageRecord;
};

export type DualTurnView = {
  turn: number;
  turnId: string;
  input: string;
  timestamp: string;
  stateweave: DualArmTurnView;
  traditional: DualArmTurnView;
};

export type DualArmHistoryEntry = {
  role: "user" | "assistant" | "error";
  content: string;
  turn: number;
};

export type DualSessionView = {
  sessionId: string;
  currentTurnId?: string;
  turnCount: number;
  storage: "jsonl-dual";
  stateweave: {
    state?: AgentState;
    history: DualArmHistoryEntry[];
    usageHistory: DualUsageRecord[];
  };
  traditional: {
    history: DualArmHistoryEntry[];
    usageHistory: DualUsageRecord[];
    activeMessageCount: number;
    activeContext: string;
    totalCompactions: number;
  };
  turns: DualTurnView[];
  historyTruncated: boolean;
  logBytes: number;
};

export type LoadedDualSession = DualSessionView & {
  traditionalMessages: AgenticMessage[];
  validBytes: number;
  hasPartialTail: boolean;
};
