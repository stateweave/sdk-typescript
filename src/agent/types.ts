import type { CausalWeaveSnapshot } from "../core/causalTypes.js";
import type { StateGraph } from "../core/types.js";
import type { Model } from "../llm/model.js";
import type { Tool } from "../tools/types.js";

export type AgentState = CausalWeaveSnapshot;

export type AgentArgs = {
  model: Model;
  tools?: Tool[];
  maxIterations?: number;
  maxNoProgressIterations?: number;
  maxPromptTokens?: number;
  projectionTargetTokens?: number;
  systemPrompt?: string;
  providerSystem?: string;
  enforceCompletionEvidence?: boolean;
  state?: AgentState;
  traceDir?: string;
};

export type AgentRunOptions = {
  signal?: AbortSignal;
  state?: AgentState;
  onProgress?: (progress: AgentProgress) => void;
};

export type AgentProgress = {
  iteration: number;
  phase: "context" | "model" | "tool" | "final" | "retrying";
  modelCalls: number;
  toolCalls: number;
  totalInputTokens: number;
  outputTokens: number;
  detail: string;
  contextTokens?: number;
  prompt?: string;
  state?: AgentState;
  graph?: StateGraph;
  rawModelOutput?: string;
  action?: "tool" | "final" | "invalid";
  tool?: string;
  error?: string;
};

export type AgentTraceStep = {
  step: number;
  nodeIds: string[];
  prompt: string;
  contextTokens: number;
  rawModelOutput: string;
  action: "tool" | "final" | "invalid";
  tool?: string;
  error?: string;
};

export type AgentRunMetadata = {
  runId: string;
  engine: "causal-weave-v3";
  tools: { name: string; description: string }[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  maxIterations: number;
  maxPromptTokens: number;
  projectionTargetTokens: number;
  stepCount: number;
  modelCalls: number;
  toolCalls: number;
  latestContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  status: "done";
};

export type AgentRunResult = {
  finalAnswer: string;
  state: AgentState;
  graph: StateGraph;
  trace: AgentTraceStep[];
  metadata: AgentRunMetadata;
};

export type AgentStartMetadata = Omit<AgentRunMetadata, "completedAt" | "durationMs" | "stepCount" | "modelCalls" | "toolCalls" | "latestContextTokens" | "totalInputTokens" | "outputTokens" | "status">;

export type AgentStreamEvent =
  | { type: "metadata"; metadata: AgentStartMetadata }
  | { type: "progress"; progress: AgentProgress }
  | { type: "final"; result: AgentRunResult };
