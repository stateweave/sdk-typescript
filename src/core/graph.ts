import type { GraphFrame, GraphNode, StateGraph } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyGraph(): StateGraph {
  return { nodes: [], edges: [] };
}

export function createInitialGraphFrame(args: {
  objective: string;
  input: string;
  availableActions: string[];
}): GraphFrame {
  const createdAt = nowIso();
  const system: GraphNode = {
    id: "system_root",
    type: "system",
    text: "StateWeave system root. The graph is the runtime state; compile GraphFrame from the graph instead of provider messages.",
    data: { activeSystemNodeId: "system_root" },
    status: "active",
    confidence: 1,
    createdAt
  };
  const input: GraphNode = {
    id: "user_input_1",
    type: "user_input",
    text: args.input,
    status: "active",
    confidence: 1,
    createdAt
  };
  const constraints = extractConstraints(args.input);

  return {
    frame: {
      objective: args.objective,
      currentFocus: "Cortex focus is user_input_1. User input nodes are the branch/focus roots; answer the latest input and attach semantic state below it.",
      focusNodeId: "user_input_1",
      latestInputNodeId: "user_input_1",
      activeUserInputNodeId: "user_input_1",
      candidateFocusNodeIds: ["system_root", "user_input_1"],
      nextExpectedOutput: "Return SWX/1 commands that grow, refocus, or reconnect the same StateGraph with useful semantic nodes, tool calls, artifacts, or a final answer.",
      activeConstraints: constraints,
      availableActions: ["add_node", "add_edge", "update_node", "focus", "call_tool", "final", ...args.availableActions]
    },
    graph: {
      nodes: [system, input],
      edges: [
        {
          id: "edge_system_root_follows_user_input_1",
          from: "system_root",
          to: "user_input_1",
          type: "follows",
          createdAt
        }
      ]
    }
  };
}

export function appendInputToGraphFrame(frame: GraphFrame, args: { objective: string; input: string }): GraphFrame {
  const next = cloneFrame(frame);
  const createdAt = nowIso();
  const inputId = `user_input_${nextIndex(next.graph.nodes, "user_input_")}`;
  const system = next.graph.nodes.find((node) => node.id === "system_root");
  const freshContext = isFreshContextRequest(args.input);
  const anchor = freshContext ? system : inputAnchor(next) ?? system ?? next.graph.nodes[0];

  next.graph.nodes.push({ id: inputId, type: "user_input", text: args.input, status: "active", confidence: 1, createdAt });
  if (anchor) next.graph.edges.push({ id: edgeId(anchor.id, "follows", inputId), from: anchor.id, to: inputId, type: "follows", createdAt });

  next.frame.objective = args.objective;
  next.frame.currentFocus = freshContext
    ? `Cortex focus is ${inputId}. The user requested fresh context, so this user_input node starts directly from system_root instead of the previous turn.`
    : `Cortex focus is ${inputId}. This user_input node continues from ${anchor?.id ?? "system_root"}; refocus or reconnect if a different graph region is more relevant.`;
  next.frame.focusNodeId = inputId;
  next.frame.latestInputNodeId = inputId;
  next.frame.activeUserInputNodeId = inputId;
  next.frame.candidateFocusNodeIds = candidateFocusNodeIds(next);
  next.frame.nextExpectedOutput = "Return SWX/1 commands that answer the active user_input node, attach semantic state under the relevant user input, move focus when needed, mark stale facts, and produce a final answer or artifact.";
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...extractConstraints(args.input)]);
  return next;
}

export function cloneFrame(frame: GraphFrame): GraphFrame {
  return structuredClone(frame);
}

function inputAnchor(frame: GraphFrame): GraphNode | undefined {
  const focus = frame.frame.focusNodeId ? frame.graph.nodes.find((node) => node.id === frame.frame.focusNodeId) : undefined;
  if (focus) return focus;
  return [...frame.graph.nodes].reverse().find((node) => node.type === "assistant_output" || node.type === "user_input" || node.type === "system");
}

function candidateFocusNodeIds(frame: GraphFrame): string[] {
  return unique([
    "system_root",
    frame.frame.activeUserInputNodeId,
    frame.frame.latestInputNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.filter((node) => node.type === "user_input").map((node) => node.id)
  ].filter((id): id is string => Boolean(id) && frame.graph.nodes.some((node) => node.id === id)));
}

function isFreshContextRequest(input: string): boolean {
  return /\b(new|fresh|separate)\s+(branch|thread|conversation|chat|context|topic|user\s+output)\b/i.test(input)
    || /\b(start|create|open)\s+(a\s+)?(new|fresh|separate)\s+(branch|thread|conversation|chat|context|topic|user\s+output)\b/i.test(input)
    || /\b(start over|fresh start|from scratch)\b/i.test(input);
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function edgeId(from: string, type: string, to: string): string {
  return `edge_${from}_${type}_${to}`.replace(/[^a-zA-Z0-9_]/g, "_");
}
