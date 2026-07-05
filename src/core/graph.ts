import type { GraphFrame, GraphNode, StateGraph } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyGraph(): StateGraph {
  return { nodes: [], edges: [] };
}

export function createInitialGraphFrame(args: {
  objective: string;
  input?: string;
  systemPrompt?: string;
  availableActions: string[];
  nodeTypes?: string[];
}): GraphFrame {
  const createdAt = nowIso();
  const system: GraphNode = {
    id: "system_root",
    type: "system",
    text: args.systemPrompt ?? "StateWeave system root. The graph is the runtime state; compile GraphFrame from the graph instead of provider messages.",
    data: { activeSystemNodeId: "system_root", ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}) },
    status: "active",
    confidence: 1,
    createdAt
  };
  const inputText = args.input?.trim();
  const input: GraphNode | undefined = inputText
    ? {
        id: "user_input_1",
        type: "user_input",
        text: inputText,
        status: "active",
        confidence: 1,
        createdAt
      }
    : undefined;
  const constraints = inputText ? extractConstraints(inputText) : [];

  return {
    frame: {
      objective: args.objective,
      currentFocus: input ? "Cortex focus is user_input_1. The model should weave this user input into the graph with GraphOps." : "Cortex focus is system_root. Append a user input or create semantic graph nodes with GraphOps.",
      focusNodeId: input ? "user_input_1" : "system_root",
      latestInputNodeId: input ? "user_input_1" : undefined,
      activeUserInputNodeId: input ? "user_input_1" : undefined,
      candidateFocusNodeIds: input ? ["system_root", "user_input_1"] : ["system_root"],
      nextExpectedOutput: input
        ? "Return SWX/1 commands that attach the active user input to the right node, create semantic nodes with model-chosen types, and produce a final answer."
        : "Return SWX/1 commands that create or update graph nodes, or wait for the next user input.",
      activeConstraints: constraints,
      availableActions: ["add_node", "add_edge", "update_node", "focus", "call_tool", "final", ...args.availableActions],
      nodeTypes: normalizeNodeTypes(args.nodeTypes ?? [])
    },
    graph: {
      nodes: input ? [system, input] : [system],
      edges: input
        ? [
            {
              id: "edge_system_root_follows_user_input_1",
              from: "system_root",
              to: "user_input_1",
              type: "follows",
              createdAt
            }
          ]
        : []
    }
  };
}

export function appendInputToGraphFrame(frame: GraphFrame, args: { objective: string; input: string }): GraphFrame {
  const next = cloneFrame(frame);
  const createdAt = nowIso();
  const inputId = `user_input_${nextIndex(next.graph.nodes, "user_input_")}`;

  next.graph.nodes.push({ id: inputId, type: "user_input", text: args.input, status: "active", confidence: 1, createdAt });

  next.frame.objective = args.objective;
  next.frame.currentFocus = `Cortex focus is ${inputId}. This user_input is pending attachment: the model must decide whether it starts from system_root, continues a prior user/assistant node, updates an existing artifact/semantic node, or relates to another graph region.`;
  next.frame.focusNodeId = inputId;
  next.frame.latestInputNodeId = inputId;
  next.frame.activeUserInputNodeId = inputId;
  next.frame.candidateFocusNodeIds = candidateFocusNodeIds(next);
  next.frame.nextExpectedOutput = "Return SWX/1 commands that first weave the active user_input into the graph with one or more meaningful edges, then create model-typed semantic/output nodes and produce a final answer.";
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...extractConstraints(args.input)]);
  return next;
}

export function cloneFrame(frame: GraphFrame): GraphFrame {
  return structuredClone(frame);
}

function candidateFocusNodeIds(frame: GraphFrame): string[] {
  return unique([
    "system_root",
    frame.frame.activeUserInputNodeId,
    frame.frame.latestInputNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.map((node) => node.id)
  ].filter((id): id is string => Boolean(id) && frame.graph.nodes.some((node) => node.id === id)));
}

function extractConstraints(input: string): string[] {
  const constraints: string[] = [];
  const rewriteMatch = input.match(/do not rewrite[^.]+\.?/i);
  if (rewriteMatch) constraints.push(rewriteMatch[0]);
  return constraints;
}

function nextIndex(nodes: GraphNode[], prefix: string): number {
  return nodes.filter((node) => node.id.startsWith(prefix)).length + 1;
}

function normalizeNodeTypes(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter((value) => /^[a-z][a-z0-9_-]{0,63}$/.test(value)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function edgeId(from: string, type: string, to: string): string {
  return `edge_${from}_${type}_${to}`.replace(/[^a-zA-Z0-9_]/g, "_");
}
