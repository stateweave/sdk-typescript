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
      currentFocus: "Use the graph rooted at system_root to respond to the latest user_input node.",
      nextExpectedOutput: "Return SWX/1 commands that grow the same StateGraph with useful semantic nodes, tool calls, artifacts, or a final answer.",
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
  const previous = latestConversationNode(next.graph.nodes) ?? next.graph.nodes.find((node) => node.id === "system_root");

  next.frame.objective = args.objective;
  next.frame.currentFocus = "Use existing StateGraph as long-running state and respond to the latest user_input node.";
  next.frame.nextExpectedOutput = "Return SWX/1 commands that continue or branch the graph intelligently, then produce a final answer or artifact when ready.";
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...extractConstraints(args.input)]);
  next.graph.nodes.push({ id: inputId, type: "user_input", text: args.input, status: "active", confidence: 1, createdAt });
  if (previous) next.graph.edges.push({ id: edgeId(previous.id, "follows", inputId), from: previous.id, to: inputId, type: "follows", createdAt });
  return next;
}

export function cloneFrame(frame: GraphFrame): GraphFrame {
  return structuredClone(frame);
}

function latestConversationNode(nodes: GraphNode[]): GraphNode | undefined {
  return [...nodes].reverse().find((node) => node.type === "assistant_output" || node.type === "user_input" || node.type === "system");
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
