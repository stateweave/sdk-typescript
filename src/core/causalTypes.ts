export type CausalNodeKind = "system" | "goal" | "inference" | "semantic" | "tool_call" | "tool_result" | "resource" | "verification" | "answer" | "protocol_error";

export type SemanticNodePayload = {
  type: string;
  key: string;
  content: unknown;
};

export type CausalWeaveNode = {
  id: string;
  kind: CausalNodeKind;
  parents: string[];
  payload: unknown;
  createdAt: string;
  sequence: number;
  resourceKey?: string;
};

export type CausalWeaveSnapshot = {
  version: 1;
  nodes: CausalWeaveNode[];
  frontier: string[];
};
