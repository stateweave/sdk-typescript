import { z } from "zod";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { agentStateToGraph } from "../src/core/causalGraph.js";
import { CausalWeave } from "../src/core/causalWeave.js";
import * as publicSdk from "../src/index.js";
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

  it("keeps many user turns bounded instead of making every historical goal mandatory", () => {
    const weave = new CausalWeave();
    const system = weave.append({ kind: "system", payload: "protocol", parents: [], advance: false });
    for (let turn = 0; turn < 100; turn++) {
      const goal = weave.append({ kind: "goal", payload: `turn-${turn} ${"detail ".repeat(20)}`, parents: [system.id, ...weave.frontier()] });
      weave.append({ kind: "answer", payload: `answer-${turn}`, parents: [goal.id] });
    }

    const compiled = weave.compile({ query: "turn-99", maxTokens: 4_000, targetTokens: 2_000, maxNodes: 32 });

    expect(compiled.prompt).toContain("turn-99");
    expect(compiled.prompt).not.toContain("turn-0 detail");
    expect(compiled.tokenEstimate.estimatedTokens).toBeLessThanOrEqual(2_100);
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

  it("indexes the whole graph while superseding redundant detailed evidence", () => {
    const weave = new CausalWeave();
    const system = weave.append({ kind: "system", payload: "protocol", parents: [], advance: false });
    weave.append({ kind: "goal", payload: "finish the application with tests and documentation", parents: [system.id] });
    const note = weave.append({
      kind: "inference",
      payload: "The SDK is implemented. I still need to create the browser entry point, focused tests, and README before verification.",
      parents: weave.frontier()
    });
    weave.append({ kind: "protocol_error", payload: "Return one action.", parents: [note.id] });
    const repeatedContent = `UNIQUE_CURRENT_SOURCE\n${"export const value = 1;\n".repeat(320)}`;
    for (let index = 0; index < 60; index++) {
      const call = weave.append({ kind: "tool_call", payload: { name: "read_file", args: { file_path: "src/model.js" } }, parents: weave.frontier() });
      const result = weave.append({
        kind: "tool_result",
        payload: { tool: "read_file", result: { path: "src/model.js", content_hash: "same", content: repeatedContent } },
        parents: [call.id]
      });
      weave.append({
        kind: "resource",
        payload: { path: "src/model.js", operation: "read_file", contentHash: "same", succeeded: true },
        parents: [result.id],
        resourceKey: "src/model.js"
      });
    }

    const compiled = weave.compile({ query: "finish application tests documentation", maxTokens: 20_000, targetTokens: 6_000, maxNodes: 48 });

    expect(compiled.prompt).toContain("GRAPH_DIGEST");
    expect(compiled.prompt).toContain("src/model.js | total=60 reads=60");
    expect(compiled.prompt).toContain("I still need to create the browser entry point");
    expect(compiled.prompt.match(/UNIQUE_CURRENT_SOURCE/g)).toHaveLength(1);
    expect(compiled.tokenEstimate.estimatedTokens).toBeLessThanOrEqual(6_200);
  });

  it("keeps chunked reads of one file at different offsets in the projection (no read ping-pong)", () => {
    const weave = new CausalWeave();
    const system = weave.append({ kind: "system", payload: "protocol", parents: [], advance: false });
    weave.append({ kind: "goal", payload: "edit app.js to be responsive", parents: [system.id] });
    const readChunk = (offset: number, body: string, hash: string) => {
      const call = weave.append({ kind: "tool_call", payload: { name: "read_file", args: { file_path: "app.js", offset, limit: 100 } }, parents: weave.frontier() });
      const result = weave.append({ kind: "tool_result", payload: { tool: "read_file", result: { path: "app.js", file_path: "app.js", offset, limit: 100, content_hash: hash, content: body } }, parents: [call.id] });
      weave.append({ kind: "resource", payload: { path: "app.js", operation: "read_file", contentHash: hash, succeeded: true }, parents: [result.id], resourceKey: "app.js" });
    };
    readChunk(0, "CHUNK_ZERO_BODY", "h0");
    readChunk(100, "CHUNK_HUNDRED_BODY", "h1");

    const compiled = weave.compile({ query: "responsive app.js", maxTokens: 20_000, targetTokens: 8_000, maxNodes: 48 });
    // Before the range-aware equivalence key, both reads collapsed to the latest
    // offset and the model could only see CHUNK_HUNDRED_BODY, forcing it to
    // re-read offset 0, then 100, then 0, ... (the loop). Both ranges now survive.
    expect(compiled.prompt).toContain("CHUNK_ZERO_BODY");
    expect(compiled.prompt).toContain("CHUNK_HUNDRED_BODY");
  });

  it("still collapses identical re-reads of the same offset", () => {
    const weave = new CausalWeave();
    const system = weave.append({ kind: "system", payload: "protocol", parents: [], advance: false });
    weave.append({ kind: "goal", payload: "inspect app.js", parents: [system.id] });
    for (let i = 0; i < 5; i++) {
      const call = weave.append({ kind: "tool_call", payload: { name: "read_file", args: { file_path: "app.js", offset: 0, limit: 100 } }, parents: weave.frontier() });
      const result = weave.append({ kind: "tool_result", payload: { tool: "read_file", result: { path: "app.js", offset: 0, limit: 100, content_hash: "same", content: "SAME_BODY" } }, parents: [call.id] });
      weave.append({ kind: "resource", payload: { path: "app.js", operation: "read_file", contentHash: "same", succeeded: true }, parents: [result.id], resourceKey: "app.js" });
    }
    const compiled = weave.compile({ query: "inspect app.js", maxTokens: 20_000, targetTokens: 8_000, maxNodes: 48 });
    expect(compiled.prompt.match(/SAME_BODY/g)).toHaveLength(1);
  });

  it("grows from ordinary tool actions without model-authored graph operations", async () => {
    const calls: unknown[] = [];
    const model = new SequenceModel([
      'TOOL_CALL {"name":"read_file","args":{"file_path":"src/app.js"}}',
      "FINAL: Inspected the application."
    ]);
    const agent = new Agent({ model, tools: [recordingTool(calls)], systemPrompt: "Work carefully.", maxIterations: 3 });

    const result = await agent.run("Inspect src/app.js");
    const toolCall = result.state.nodes.find((node) => node.kind === "tool_call")!;
    const toolResult = result.state.nodes.find((node) => node.kind === "tool_result")!;
    const answer = result.state.nodes.find((node) => node.kind === "answer")!;

    expect(calls).toEqual([{ file_path: "src/app.js" }]);
    expect(toolCall.parents).toEqual([...result.trace[0].nodeIds].sort());
    expect(toolResult.parents).toEqual([toolCall.id]);
    expect(answer.parents).toEqual([...result.trace[1].nodeIds].sort());
    expect(result.state.nodes.every((node) => !("role" in node))).toBe(true);
    expect(model.prompts.every((prompt) => prompt.startsWith("CAUSAL_WEAVE/1"))).toBe(true);
  });

  it("continues one causal frontier across turns and commits only successful runs", async () => {
    const agent = new Agent({
      model: new SequenceModel(["FINAL: First answer.", "not an action"]),
      tools: [],
      maxIterations: 1,
      enforceCompletionEvidence: false
    });

    const first = await agent.run("First goal");
    const committed = agent.getState()!;
    const firstAnswer = committed.nodes.find((node) => node.kind === "answer")!;
    await expect(agent.run("Broken second goal")).rejects.toThrow(/recursion limit/i);

    expect(agent.getState()).toEqual(committed);
    expect(first.state).toEqual(committed);
    expect(firstAnswer.payload).toBe("First answer.");
  });

  it("links a later goal to the prior frontier and supports state export/import", async () => {
    const first = new Agent({ model: new SequenceModel(["FINAL: Remembered."]), tools: [], enforceCompletionEvidence: false });
    const initial = await first.run("Remember this");
    const resumed = new Agent({ model: new SequenceModel(["FINAL: Continued."]), tools: [], state: initial.state, enforceCompletionEvidence: false });
    const next = await resumed.run("Continue");
    const earlierAnswer = initial.state.nodes.find((node) => node.kind === "answer")!;
    const laterGoal = next.state.nodes.filter((node) => node.kind === "goal").at(-1)!;

    expect(laterGoal.parents).toContain(earlierAnswer.id);
    expect(next.graph.nodes.some((node) => node.type === "user_input")).toBe(true);
    expect(next.graph.nodes.some((node) => node.type === "assistant_output")).toBe(true);
  });

  it("keeps visualization payloads bounded while preserving lossless state", () => {
    const weave = new CausalWeave();
    weave.append({ kind: "system", payload: "x".repeat(10_000), parents: [], advance: false });
    const state = weave.snapshot();
    const graph = agentStateToGraph(state);

    expect(state.nodes[0]!.payload).toHaveLength(10_000);
    expect(graph.nodes[0]!.text.length).toBeLessThan(2_100);
  });

  it("rejects tampered imported state and exposes only one public agent class", () => {
    const weave = new CausalWeave();
    weave.append({ kind: "system", payload: "system", parents: [], advance: false });
    const tampered = weave.snapshot();
    tampered.nodes[0]!.id = "cw_tampered";

    expect(() => new Agent({ model: new SequenceModel([]), tools: [], state: tampered })).toThrow(/identity mismatch/i);
    expect(publicSdk.Agent).toBe(Agent);
    expect("StateWeaveAgent" in publicSdk).toBe(false);
    expect("CausalWeaveAgent" in publicSdk).toBe(false);
  });

  it("uses the exact same tool action and executor semantics as the transcript baseline", async () => {
    const output = ['TOOL_CALL {"name":"read_file","args":{"file_path":"same.js"}}', "FINAL: Done."];
    const transcriptCalls: unknown[] = [];
    const causalCalls: unknown[] = [];
    const transcript = new AgenticBaseline({ model: new SequenceModel(output), tools: [recordingTool(transcriptCalls)], systemPrompt: "Shared system", maxIterations: 3 });
    const causal = new Agent({ model: new SequenceModel(output), tools: [recordingTool(causalCalls)], systemPrompt: "Shared system", maxIterations: 3 });

    const [transcriptResult, causalResult] = await Promise.all([
      transcript.run("Read same.js"),
      causal.run("Read same.js")
    ]);

    expect(transcriptResult.completed).toBe(true);
    expect(causalResult.finalAnswer).toBe("Done.");
    expect(causalCalls).toEqual(transcriptCalls);
    expect(causalResult.metadata.toolCalls).toBe(transcriptResult.toolCalls);
    expect(causalResult.metadata.modelCalls).toBe(transcriptResult.modelCalls);
  });
});
