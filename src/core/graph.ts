import type { GraphFrame, GraphNode, StateGraph } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export const defaultSystemPrompt = "StateWeave system root. The graph is the runtime state; compile GraphFrame from the graph instead of provider messages.";

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
    text: args.systemPrompt ?? defaultSystemPrompt,
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
      currentFocus: input ? "Cortex focus is user_input_1; weave it into the graph." : "Cortex focus is system_root; append input or create semantic nodes.",
      focusNodeId: input ? "user_input_1" : "system_root",
      latestInputNodeId: input ? "user_input_1" : undefined,
      activeUserInputNodeId: input ? "user_input_1" : undefined,
      candidateFocusNodeIds: input ? ["system_root", "user_input_1"] : ["system_root"],
      nextExpectedOutput: input
        ? "SWX/1: attach user_input to the right node, add semantic nodes if recording new facts, then @final/@final_ref with a human answer."
        : "SWX/1: create/update nodes, or wait for input.",
      activeConstraints: constraints,
      availableActions: ["add_node", "add_edge", "update_node", "focus", "zoom", "call_tool", "final", ...args.availableActions],
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
  assertValidGraphFrame(frame);
  const next = forkFrame(frame);
  const createdAt = nowIso();
  const inputId = nextSequenceId(next.graph.nodes, "user_input_");

  next.graph.nodes.push({ id: inputId, type: "user_input", text: args.input, status: "active", confidence: 1, createdAt });

  next.frame.objective = args.objective;
  next.frame.currentFocus = `Cortex focus is ${inputId}; StateWeave will attach this user_input structurally while the model handles task semantics and evidence.`;
  next.frame.focusNodeId = inputId;
  next.frame.latestInputNodeId = inputId;
  next.frame.activeUserInputNodeId = inputId;
  next.frame.candidateFocusNodeIds = candidateFocusNodeIds(next);
  next.frame.nextExpectedOutput = "SWX/1: use one evidence tool per transaction when needed, add semantic nodes only for durable new facts, then return a supported @final/@final_ref answer.";
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...extractConstraints(args.input)]);
  return next;
}

export function cloneFrame(frame: GraphFrame): GraphFrame {
  return structuredClone(frame);
}

// Internal copy-on-write forks share immutable nested node data so long traces stay bounded.
export function forkFrame(frame: GraphFrame): GraphFrame {
  return { frame: forkFrameMetadata(frame.frame), graph: forkGraph(frame.graph) };
}

export function forkFrameMetadataOnly(frame: GraphFrame): GraphFrame {
  return { frame: forkFrameMetadata(frame.frame), graph: frame.graph };
}

export function forkGraph(graph: StateGraph): StateGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge }))
  };
}

function forkFrameMetadata(frame: GraphFrame["frame"]): GraphFrame["frame"] {
  return {
    ...frame,
    activeConstraints: [...frame.activeConstraints],
    availableActions: [...frame.availableActions],
    ...(frame.candidateFocusNodeIds ? { candidateFocusNodeIds: [...frame.candidateFocusNodeIds] } : {}),
    ...(frame.nodeTypes ? { nodeTypes: [...frame.nodeTypes] } : {})
  };
}

function candidateFocusNodeIds(frame: GraphFrame): string[] {
  return unique([
    "system_root",
    frame.frame.activeUserInputNodeId,
    frame.frame.latestInputNodeId,
    frame.frame.focusNodeId,
    ...frame.graph.nodes.filter((node) => node.type === "file" && node.status === "active").slice(-8).map((node) => node.id),
    ...frame.graph.nodes.filter((node) => node.type === "user_input" || node.type === "assistant_output").slice(-12).map((node) => node.id)
  ].filter((id): id is string => Boolean(id) && frame.graph.nodes.some((node) => node.id === id)));
}

function extractConstraints(input: string): string[] {
  const constraints: string[] = [];
  const rewriteMatch = input.match(/do not rewrite[^.]+\.?/i);
  if (rewriteMatch) constraints.push(rewriteMatch[0]);
  return constraints;
}

export function assertValidGraphFrame(frame: GraphFrame): void {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const node of frame.graph.nodes) {
    if (nodeIds.has(node.id)) errors.push(`duplicate node id ${node.id}`);
    nodeIds.add(node.id);
  }
  for (const edge of frame.graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from)) errors.push(`edge ${edge.id} references missing from node ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`edge ${edge.id} references missing to node ${edge.to}`);
  }
  for (const [name, id] of [
    ["focusNodeId", frame.frame.focusNodeId],
    ["latestInputNodeId", frame.frame.latestInputNodeId],
    ["activeUserInputNodeId", frame.frame.activeUserInputNodeId]
  ] as const) {
    if (id && !nodeIds.has(id)) errors.push(`${name} references missing node ${id}`);
  }
  if (errors.length) throw new Error(`Invalid GraphFrame: ${errors.join("; ")}`);
}

function nextSequenceId(nodes: GraphNode[], prefix: string): string {
  let next = nodes.reduce((max, node) => {
    const match = node.id.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  while (nodes.some((node) => node.id === `${prefix}${next}`)) next += 1;
  return `${prefix}${next}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
