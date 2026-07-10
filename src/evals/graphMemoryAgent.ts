import type { Model, ModelInput } from "../llm/model.js";
import type { GraphFrame } from "../core/types.js";
import { applyOps } from "../core/applyOps.js";
import { createInitialGraphFrame, appendInputToGraphFrame, cloneFrame } from "../core/graph.js";
import { projectGraph } from "../core/projection.js";
import { serializeGraphFrame } from "../core/serialize.js";
import { parseAndValidateOps } from "../core/validateOps.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";

export type GraphMemoryResult = {
  answer: string;
  tokenEstimate: number;
  latencyMs: number;
  nodeCount: number;
  edgeCount: number;
  transactionValid: boolean;
  transactionError?: string;
  retrievedNodeIds: string[];
  focusNodeIds: string[];
  retrievedEvidence: Array<{ id: string; type: string; text: string }>;
};

// Pure StateWeave memory primitive: exactly one model call, no tools and no
// agent loop. The completion contains both the human answer and GraphOps. The
// SDK parses and applies that transaction so future projections use a real
// semantic graph rather than an assistant transcript disguised as one.
export class GraphMemoryAgent {
  private model: Model;
  private systemPrompt: string;
  private frame: GraphFrame;

  constructor(args: { model: Model; systemPrompt?: string }) {
    this.model = args.model;
    this.systemPrompt = args.systemPrompt ?? "You are a helpful, precise assistant. Answer concretely and remember everything discussed so far.";
    this.frame = createInitialGraphFrame({
      objective: "Recall and synthesize from the conversation graph.",
      input: "",
      systemPrompt: this.systemPrompt,
      availableActions: [],
      nodeTypes: ["user_input", "assistant_output"]
    });
  }

  getNodeCount(): number {
    return this.frame.graph.nodes.length;
  }

  getFrame(): GraphFrame {
    return cloneFrame(this.frame);
  }

  async run(prompt: string): Promise<GraphMemoryResult> {
    const startedAt = Date.now();
    this.frame = appendInputToGraphFrame(this.frame, { objective: "Answer the user's question.", input: prompt });

    const projection = projectGraph(this.frame.graph, { focusNodeId: this.frame.frame.focusNodeId, zoom: this.frame.frame.zoom });
    const retrievedSet = new Set(projection.retrievedNodeIds);
    const retrievedEvidence = projection.focusNodes
      .filter((node) => retrievedSet.has(node.id))
      .slice(0, 16)
      .map((node) => ({ id: node.id, type: node.type, text: node.text.slice(0, 240) }));
    const serialized = serializeGraphFrame(this.frame);
    const input: ModelInput = {
      prompt: serialized,
      frame: this.frame,
      mode: "graph_ops",
      system: "You are the StateWeave one-call graph-memory primitive. Return one valid SWX/1 transaction. Before creating facts or answering, connect the latest pending user_input to a node that existed before this turn; use @edge system_root follows <latest user_input id> for a fresh topic. Then connect every new node and include exactly one direct @final answer. Never return prose outside SWX/1."
    };
    const output = await this.model.complete(input);

    try {
      const ops = parseAndValidateOps(output.text);
      const final = ops.find((op): op is Extract<(typeof ops)[number], { op: "final" }> => op.op === "final");
      if (!final) throw new Error("SWX transaction did not include @final or @final_ref");
      this.frame = applyOps(this.frame, ops);
      return {
        answer: final.answer,
        tokenEstimate: estimateStateWeaveTokens(serialized).estimatedTokens,
        latencyMs: Date.now() - startedAt,
        nodeCount: this.frame.graph.nodes.length,
        edgeCount: this.frame.graph.edges.length,
        transactionValid: true,
        retrievedNodeIds: projection.retrievedNodeIds,
        focusNodeIds: projection.focusNodes.map((node) => node.id),
        retrievedEvidence
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        answer: `(invalid StateWeave transaction: ${message})`,
        tokenEstimate: estimateStateWeaveTokens(serialized).estimatedTokens,
        latencyMs: Date.now() - startedAt,
        nodeCount: this.frame.graph.nodes.length,
        edgeCount: this.frame.graph.edges.length,
        transactionValid: false,
        transactionError: message,
        retrievedNodeIds: projection.retrievedNodeIds,
        focusNodeIds: projection.focusNodes.map((node) => node.id),
        retrievedEvidence
      };
    }
  }
}
