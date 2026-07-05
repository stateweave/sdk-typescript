export type StructuralNodeType = "system" | "user_input" | "assistant_output" | "tool_call" | "tool_result";
export type NodeType = StructuralNodeType | (string & {});

export type EdgeType =
  | "follows"
  | "creates"
  | "supports"
  | "contradicts"
  | "explains"
  | "depends_on"
  | "addresses"
  | "validates"
  | "constrains"
  | "causes"
  | "relates_to";

export type GraphNode = {
  id: string;
  type: NodeType;
  text: string;
  data?: Record<string, unknown>;
  confidence?: number;
  status?: "active" | "resolved" | "rejected" | "stale";
  createdAt: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  createdAt: string;
};

export type StateGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphFrame = {
  frame: {
    objective: string;
    currentFocus: string;
    focusNodeId?: string;
    latestInputNodeId?: string;
    activeUserInputNodeId?: string;
    candidateFocusNodeIds?: string[];
    nextExpectedOutput: string;
    activeConstraints: string[];
    availableActions: string[];
  };
  graph: StateGraph;
};

export type GraphOp =
  | { op: "add_node"; node: Omit<GraphNode, "createdAt"> }
  | { op: "add_edge"; from: string; to: string; type: EdgeType }
  | { op: "update_node"; id: string; patch: Partial<GraphNode> }
  | { op: "focus"; currentFocus: string; nodeId?: string }
  | { op: "call_tool"; tool: string; args: Record<string, unknown> }
  | { op: "final"; answer: string; artifactId?: string };

export type TraceStep = {
  step: number;
  frameBefore: GraphFrame;
  prompt: string;
  tokenEstimate: { estimatedTokens: number; messageCount: number };
  streamedTokens: string[];
  rawModelOutput: string;
  parsedOps: GraphOp[];
  frameAfter: GraphFrame;
  error?: string;
};

export type AgentResult = {
  finalAnswer: string;
  graph: StateGraph;
  trace: TraceStep[];
};

export type StateWeaveStreamEvent =
  | { type: "frame"; step: number; phase: "before" | "after"; frame: GraphFrame }
  | { type: "token"; step: number; token: string }
  | { type: "ops"; step: number; ops: GraphOp[] }
  | { type: "final"; result: AgentResult };
