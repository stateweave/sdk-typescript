import { z } from "zod";
import { describe, expect, it } from "vitest";
import { CausalWeaveAgent } from "../src/agent/causalWeaveAgent.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import { AgenticBaseline } from "../src/evals/agenticBaseline.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";
import type { Tool } from "../src/tools/types.js";

class SequenceModel implements Model {
  private index = 0;
  readonly prompts: string[] = [];

  constructor(private readonly outputs: string[]) {}

  async complete(input: ModelInput): Promise<ModelOutput> {
    this.prompts.push(input.prompt);
    const text = this.outputs[this.index++];
    if (text === undefined) throw new Error("SequenceModel exhausted");
    return { text };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelToken> {
    const output = await this.complete(input);
    yield { type: "token", token: output.text };
  }
}

function recordingTool(calls: unknown[]): Tool {
  return {
    name: "read_file",
    description: "Read one file.",
    schema: z.object({ file_path: z.string() }),
    execute: async (args) => {
      const parsed = args as { file_path: string };
      calls.push(parsed);
      return { file_path: parsed.file_path, content_hash: "abc123", content: "export const ready = true;" };
    }
  };
}

describe("Causal Weave", () => {
  it("uses deterministic content-addressed nodes and exact read-set parents", () => {
    const first = new CausalWeave();
    const firstSystem = first.append({ kind: "system", payload: "shared", parents: [], advance: false });
    const firstGoal = first.append({ kind: "goal", payload: "build", parents: [firstSystem.id] });
    const compiled = first.compile({ query: "build", maxTokens: 4_000 });
    const action = first.append({ kind: "tool_call", payload: { name: "read_file", args: { file_path: "a.js" } }, parents: compiled.nodeIds });

    const second = new CausalWeave();
    const secondSystem = second.append({ kind: "system", payload: "shared", parents: [], advance: false });
    const secondGoal = second.append({ kind: "goal", payload: "build", parents: [secondSystem.id] });

    expect(firstSystem.id).toBe(secondSystem.id);
    expect(firstGoal.id).toBe(secondGoal.id);
    expect(action.parents).toEqual([...compiled.nodeIds].sort());
  });

  it("keeps current resource heads in a bounded compiled graph", () => {
    const weave = new CausalWeave();
    const system = weave.append({ kind: "system", payload: "protocol", parents: [], advance: false });
    const goal = weave.append({ kind: "goal", payload: "maintain project files", parents: [system.id] });
    const oldResource = weave.append({ kind: "resource", payload: { path: "src/app.js", contentHash: "old" }, parents: [goal.id], resourceKey: "src/app.js" });
    weave.append({ kind: "resource", payload: { path: "src/app.js", contentHash: "current" }, parents: [oldResource.id], resourceKey: "src/app.js" });
    for (let index = 0; index < 80; index++) weave.append({ kind: "inference", payload: `irrelevant planning ${index}`, parents: weave.frontier() });

    const compiled = weave.compile({ query: "app project", maxTokens: 2_000, maxNodes: 20 });

    expect(compiled.prompt).toContain('"contentHash":"current"');
    expect(compiled.prompt).toContain("CAUSAL_WEAVE/1");
    expect(compiled.tokenEstimate.estimatedTokens).toBeLessThanOrEqual(2_100);
    expect(compiled.nodeIds.length).toBeLessThanOrEqual(30);
  });

  it("does not recursively resend prior inference read sets as causal closure", () => {
    const weave = new CausalWeave();
    const system = weave.append({ kind: "system", payload: "protocol", parents: [], advance: false });
    weave.append({ kind: "goal", payload: "long running task", parents: [system.id] });
    for (let step = 0; step < 120; step++) {
      const compiled = weave.compile({ query: "long running task", maxTokens: 8_000, maxNodes: 32 });
      const call = weave.append({ kind: "tool_call", payload: { name: "read_file", args: { file_path: `file-${step % 4}.js` } }, parents: compiled.nodeIds });
      weave.append({ kind: "tool_result", payload: { file_path: `file-${step % 4}.js`, content: `value-${step}` }, parents: [call.id] });
    }

    const compiled = weave.compile({ query: "long running task", maxTokens: 8_000, maxNodes: 32 });

    expect(weave.snapshot().nodes.length).toBeGreaterThan(200);
    expect(compiled.nodeIds.length).toBeLessThanOrEqual(40);
    expect(compiled.tokenEstimate.estimatedTokens).toBeLessThan(4_000);
  });

  it("grows from ordinary tool actions without model-authored graph operations", async () => {
    const calls: unknown[] = [];
    const model = new SequenceModel([
      'TOOL_CALL {"name":"read_file","args":{"file_path":"src/app.js"}}',
      "FINAL: Inspected the application."
    ]);
    const agent = new CausalWeaveAgent({ model, tools: [recordingTool(calls)], systemPrompt: "Work carefully.", maxIterations: 3 });

    const result = await agent.run("Inspect src/app.js");
    const toolCall = result.weave.nodes.find((node) => node.kind === "tool_call")!;
    const toolResult = result.weave.nodes.find((node) => node.kind === "tool_result")!;
    const answer = result.weave.nodes.find((node) => node.kind === "answer")!;

    expect(calls).toEqual([{ file_path: "src/app.js" }]);
    expect(toolCall.parents).toEqual([...result.trace[0].nodeIds].sort());
    expect(toolResult.parents).toEqual([toolCall.id]);
    expect(answer.parents).toEqual([...result.trace[1].nodeIds].sort());
    expect(result.weave.nodes.every((node) => !("role" in node))).toBe(true);
    expect(model.prompts.every((prompt) => prompt.startsWith("CAUSAL_WEAVE/1"))).toBe(true);
  });

  it("uses the exact same tool action and executor semantics as the transcript baseline", async () => {
    const output = ['TOOL_CALL {"name":"read_file","args":{"file_path":"same.js"}}', "FINAL: Done."];
    const transcriptCalls: unknown[] = [];
    const causalCalls: unknown[] = [];
    const transcript = new AgenticBaseline({ model: new SequenceModel(output), tools: [recordingTool(transcriptCalls)], systemPrompt: "Shared system", maxIterations: 3 });
    const causal = new CausalWeaveAgent({ model: new SequenceModel(output), tools: [recordingTool(causalCalls)], systemPrompt: "Shared system", maxIterations: 3 });

    const [transcriptResult, causalResult] = await Promise.all([
      transcript.run("Read same.js"),
      causal.run("Read same.js")
    ]);

    expect(transcriptResult.completed).toBe(true);
    expect(causalResult.finalAnswer).toBe("Done.");
    expect(causalCalls).toEqual(transcriptCalls);
    expect(causalResult.metrics.toolCalls).toBe(transcriptResult.toolCalls);
    expect(causalResult.metrics.modelCalls).toBe(transcriptResult.modelCalls);
  });
});
