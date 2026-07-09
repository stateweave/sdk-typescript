import type { Model, ModelInput } from "../llm/model.js";
import type { GraphFrame } from "../core/types.js";
import { createInitialGraphFrame, appendInputToGraphFrame, cloneFrame } from "../core/graph.js";
import { serializeGraphFrame } from "../core/serialize.js";
import { estimateStateWeaveTokens } from "../llm/tokenizer.js";

export type GraphMemoryResult = {
  answer: string;
  tokenEstimate: number;
  latencyMs: number;
  nodeCount: number;
};

// Pure StateWeave memory substrate — no tools, no agent loop, no GraphOps.
// One model call per turn: project the graph → serialize → model → append answer.
// This is the fair comparison against naive messages[]: both do exactly one call,
// both face the same task. The only difference is the memory representation
// (append-only graph + disposable projection vs growing message transcript).
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

    const serialized = serializeGraphFrame(this.frame);
    const input: ModelInput = { prompt: serialized, mode: "text" };
    const output = await this.model.complete(input);
    const answer = output.text.trim();

    // Append the answer as an assistant_output node — append-only ground truth.
    const assistantId = `assistant_output_${this.nextAssistantId()}`;
    this.frame.graph.nodes.push({
      id: assistantId,
      type: "assistant_output",
      text: answer,
      status: "active",
      confidence: 1,
      createdAt: new Date().toISOString()
    });

    return {
      answer,
      tokenEstimate: estimateStateWeaveTokens(serialized).estimatedTokens,
      latencyMs: Date.now() - startedAt,
      nodeCount: this.frame.graph.nodes.length
    };
  }

  private nextAssistantId(): number {
    const max = this.frame.graph.nodes
      .filter((n) => n.id.startsWith("assistant_output_"))
      .map((n) => Number(n.id.replace("assistant_output_", "")))
      .reduce((a, b) => Math.max(a, b), 0);
    return max + 1;
  }
}
