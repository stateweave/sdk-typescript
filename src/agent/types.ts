import type { CausalContextMode, CausalWeaveSnapshot } from "../core/causalTypes.js";
export type { CausalContextMode } from "../core/causalTypes.js";
import type { StateGraph } from "../core/types.js";
import type { Model } from "../llm/model.js";
import type { Tool } from "../tools/types.js";

export type AgentState = CausalWeaveSnapshot;

export type SemanticNodeType = {
  name: string;
  description: string;
};

export const defaultSemanticNodeTypes: SemanticNodeType[] = [
  { name: "memory", description: "A durable fact or context that should remain available in later work." },
  { name: "preference", description: "A stable user preference, choice, or working style stated or confirmed by the user." },
  { name: "wisdom", description: "A reusable, evidence-supported lesson, principle, or decision rule." },
  { name: "artifact", description: "A durable output or artifact reference, with enough metadata to find or render it again." }
];

export type AgentArgs = {
  model: Model;
  tools?: Tool[];
  maxIterations?: number;
  maxNoProgressIterations?: number;
  maxPromptTokens?: number;
  projectionTargetTokens?: number;
  projectionMaxNodes?: number;
  contextMode?: CausalContextMode;
  systemPrompt?: string;
  providerSystem?: string;
  enforceCompletionEvidence?: boolean;
  nodeTypes?: SemanticNodeType[];
  allowDynamicNodeTypes?: boolean;
  state?: AgentState;
  traceDir?: string;
};

export type AgentRunOptions = {
  signal?: AbortSignal;
  state?: AgentState;
  onProgress?: (progress: AgentProgress) => void;
};

export type AgentModelEvent =
  | { type: "token"; iteration: number; token: string }
  | { type: "metadata"; iteration: number; metadata: Record<string, unknown> };

export type TokenCountSource = "provider" | "estimated" | "mixed";

export type AgentProgress = {
  iteration: number;
  phase: "context" | "model" | "tool" | "final" | "retrying";
  modelCalls: number;
  toolCalls: number;
  totalInputTokens: number;
  outputTokens: number;
  tokenCountSource?: TokenCountSource;
  peakContextTokens?: number;
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
  projectionMaxNodes: number;
  contextMode: CausalContextMode;
  nodeTypes: SemanticNodeType[];
  allowDynamicNodeTypes: boolean;
  stepCount: number;
  modelCalls: number;
  toolCalls: number;
  latestContextTokens: number;
  peakContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  tokenCountSource: TokenCountSource;
  status: "done";
};

export type AgentRunResult = {
  finalAnswer: string;
  state: AgentState;
  graph: StateGraph;
  trace: AgentTraceStep[];
  metadata: AgentRunMetadata;
};

export type AgentStartMetadata = Omit<AgentRunMetadata, "completedAt" | "durationMs" | "stepCount" | "modelCalls" | "toolCalls" | "latestContextTokens" | "peakContextTokens" | "totalInputTokens" | "outputTokens" | "tokenCountSource" | "status">;

export type AgentStreamEvent =
  | { type: "metadata"; metadata: AgentStartMetadata }
  | { type: "model_token"; iteration: number; token: string }
  | { type: "model_metadata"; iteration: number; metadata: Record<string, unknown> }
  | { type: "progress"; progress: AgentProgress }
  | { type: "final"; result: AgentRunResult };
