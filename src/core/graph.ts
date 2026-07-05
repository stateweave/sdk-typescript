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
      currentFocus: "Cortex focus is user_input_1. The graph is non-linear: answer the latest user input, and create/activate branches when the task asks for a new context.",
      focusNodeId: "user_input_1",
      latestInputNodeId: "user_input_1",
      activeBranchNodeId: "system_root",
      candidateBranchNodeIds: ["system_root"],
      nextExpectedOutput: "Return SWX/1 commands that grow, branch, merge, or refocus the same StateGraph with useful semantic nodes, tool calls, artifacts, or a final answer.",
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
  const branchRequested = isBranchRequest(args.input);
  const inheritedBranchId = activeBranchNode(next)?.id;
  const branch = branchRequested ? createBranchNode(next, args.input, createdAt) : undefined;
  const anchor = branch ?? inputAnchor(next) ?? next.graph.nodes.find((node) => node.id === "system_root");
  const branchId = branch?.id ?? (inheritedBranchId === "system_root" ? undefined : inheritedBranchId) ?? (anchor?.type === "branch" ? anchor.id : undefined);

  next.frame.objective = args.objective;
  next.frame.currentFocus = branch
    ? `Cortex branch ${branch.id} was created from system_root. Respond to ${inputId} inside that new branch; do not append this turn to the previous linear conversation unless it is explicitly relevant.`
    : `Cortex focus is ${anchor?.id ?? "system_root"}. Respond to ${inputId}; branch, merge, update, or refocus the graph if the user intent calls for it.`;
  next.frame.focusNodeId = inputId;
  next.frame.latestInputNodeId = inputId;
  next.frame.activeBranchNodeId = branchId ?? next.frame.activeBranchNodeId ?? "system_root";
  next.frame.candidateBranchNodeIds = candidateBranchNodeIds(next);
  next.frame.nextExpectedOutput = "Return SWX/1 commands that continue the active graph region, create a new branch from any relevant node, merge related branches, mark stale facts, and produce a final answer or artifact when ready.";
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...extractConstraints(args.input)]);
  next.graph.nodes.push({ id: inputId, type: "user_input", text: args.input, data: branchId && branchId !== "system_root" ? { branchId } : undefined, status: "active", confidence: 1, createdAt });
  if (anchor) next.graph.edges.push({ id: edgeId(anchor.id, "follows", inputId), from: anchor.id, to: inputId, type: "follows", createdAt });
  return next;
}

export function cloneFrame(frame: GraphFrame): GraphFrame {
  return structuredClone(frame);
}

function inputAnchor(frame: GraphFrame): GraphNode | undefined {
  const focus = frame.frame.focusNodeId ? frame.graph.nodes.find((node) => node.id === frame.frame.focusNodeId) : undefined;
  if (focus) return focus;
  const activeBranch = activeBranchNode(frame);
  if (activeBranch) return activeBranch;
  return [...frame.graph.nodes].reverse().find((node) => node.type === "assistant_output" || node.type === "user_input" || node.type === "branch" || node.type === "system");
}

function activeBranchNode(frame: GraphFrame): GraphNode | undefined {
  const branch = frame.frame.activeBranchNodeId ? frame.graph.nodes.find((node) => node.id === frame.frame.activeBranchNodeId && (node.type === "branch" || node.type === "system")) : undefined;
  if (branch) return branch;
  return frame.graph.nodes.find((node) => node.id === "system_root");
}

function createBranchNode(frame: GraphFrame, input: string, createdAt: string): GraphNode {
  const system = frame.graph.nodes.find((node) => node.id === "system_root") ?? frame.graph.nodes[0];
  const branch: GraphNode = {
    id: `branch_${nextIndex(frame.graph.nodes, "branch_")}`,
    type: "branch",
    text: `Branch requested by user: ${shorten(input, 140)}`,
    data: { requestedBy: "user", parentNodeId: system?.id ?? "system_root" },
    status: "active",
    confidence: 1,
    createdAt
  };
  frame.graph.nodes.push(branch);
  if (system) frame.graph.edges.push({ id: edgeId(system.id, "supports", branch.id), from: system.id, to: branch.id, type: "supports", createdAt });
  return branch;
}

function candidateBranchNodeIds(frame: GraphFrame): string[] {
  return unique([
    "system_root",
    frame.frame.activeBranchNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.filter((node) => node.type === "branch" && node.status !== "rejected").map((node) => node.id)
  ].filter((id): id is string => Boolean(id) && frame.graph.nodes.some((node) => node.id === id)));
}

function isBranchRequest(input: string): boolean {
  return /\b(new|fresh|separate)\s+(branch|thread|conversation|chat|context|topic|user\s+output)\b/i.test(input)
    || /\b(start|create|open)\s+(a\s+)?(new|fresh|separate)\s+(branch|thread|conversation|chat|context|topic|user\s+output)\b/i.test(input)
    || /\b(start over|fresh start|from scratch)\b/i.test(input);
}

function shorten(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
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
