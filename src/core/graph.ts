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
  const intent: GraphNode = {
    id: "intent_1",
    type: "intent",
    text: args.objective,
    status: "active",
    confidence: 1,
    createdAt
  };
  const fact: GraphNode = {
    id: "fact_input",
    type: "fact",
    text: args.input,
    status: "active",
    confidence: 1,
    createdAt
  };
  const constraints = extractConstraints(args.input);

  return {
    frame: {
      objective: args.objective,
      currentFocus: "Understand the task and decide whether a tool is needed.",
      nextExpectedOutput: "Return GraphOps that add useful facts, call tools, or produce a final answer.",
      activeConstraints: constraints,
      availableActions: ["add_node", "add_edge", "update_node", "focus", "call_tool", "final", ...args.availableActions]
    },
    graph: {
      nodes: [intent, fact],
      edges: [
        {
          id: "edge_fact_input_supports_intent_1",
          from: "fact_input",
          to: "intent_1",
          type: "supports",
          createdAt
        }
      ]
    }
  };
}

function extractConstraints(input: string): string[] {
  const constraints: string[] = [];
  const rewriteMatch = input.match(/do not rewrite[^.]+\.?/i);
  if (rewriteMatch) constraints.push(rewriteMatch[0]);
  return constraints;
}

export function appendInputToGraphFrame(frame: GraphFrame, args: { objective: string; input: string }): GraphFrame {
  const next = cloneFrame(frame);
  const createdAt = nowIso();
  const intentId = `intent_${nextIndex(next.graph.nodes, "intent_")}`;
  const factId = `fact_input_${nextIndex(next.graph.nodes, "fact_input")}`;

  next.frame.objective = args.objective;
  next.frame.currentFocus = "Use existing graph state as short-term memory and respond to the latest input.";
  next.frame.nextExpectedOutput = "Return GraphOps that update memory, call tools, or produce a final answer.";
  next.frame.activeConstraints = unique([...next.frame.activeConstraints, ...extractConstraints(args.input)]);
  next.graph.nodes.push(
    { id: intentId, type: "intent", text: args.objective, status: "active", confidence: 1, createdAt },
    { id: factId, type: "fact", text: args.input, status: "active", confidence: 1, createdAt }
  );
  next.graph.edges.push({ id: `edge_${factId}_supports_${intentId}`, from: factId, to: intentId, type: "supports", createdAt });
  return next;
}

export function cloneFrame(frame: GraphFrame): GraphFrame {
  return structuredClone(frame);
}

function nextIndex(nodes: GraphNode[], prefix: string): number {
  return nodes.filter((node) => node.id.startsWith(prefix)).length + 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
