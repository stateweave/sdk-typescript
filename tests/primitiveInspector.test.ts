import { describe, expect, it, vi } from "vitest";
import { inspectPrimitiveTask, parseCliArgs } from "../src/cli.js";
import { serializeGraphFrame } from "../src/core/serialize.js";
import type { GraphFrame } from "../src/core/types.js";
import type { Model } from "../src/llm/model.js";

describe("primitive inspector", () => {
  it("keeps configured providers off unless --live is explicit", async () => {
    vi.stubEnv("STATEWEAVE_MODEL_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "not-a-real-key");
    const fetch = vi.fn(() => { throw new Error("Network is disabled"); });
    vi.stubGlobal("fetch", fetch);
    expect(parseCliArgs(["--input", "My name is Ada"]).configuredModel).toBe(false);
    expect(parseCliArgs(["--live", "My name is Ada"]).configuredModel).toBe(true);
    const result = await inspectPrimitiveTask("My name is Ada");
    expect(result.after.graph.nodes.some(node => node.type === "assistant_output" && node.text === "Nice to meet you, Ada.")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["--input"], ["--input", "--live"], ["--input", "first", "--input", "second"],
    ["--input", "first", "second"], ["--model", "mock"], ["--compare"]
  ])("rejects ambiguous or unsupported CLI arguments %j", (...args) => {
    expect(() => parseCliArgs(args)).toThrow();
  });

  it("accepts one positional task and inspection flags", () => {
    expect(parseCliArgs(["My", "name", "is", "Ada", "--prompt", "--graph"])).toMatchObject({
      input: "My name is Ada", configuredModel: false, showPrompt: true, showGraph: true
    });
  });

  it("uses the actual frame serializer and applies one immutable transaction", async () => {
    const complete = vi.fn<Model["complete"]>(async input => ({ text: 'SWX/1\n@node release fact "Friday"\n@final "Recorded."' }));
    const model: Model = { complete, async *stream() { throw new Error("Streaming is not part of a transaction"); } };
    const result = await inspectPrimitiveTask("Record the Friday release", model);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]![0]).toMatchObject({ mode: "graph_ops", frame: result.before, prompt: serializeGraphFrame(result.before) });
    expect(result.before.graph.nodes).toHaveLength(2);
    expect(result.before.graph.nodes.some(node => node.id === "release")).toBe(false);
    expect(result.after.graph.nodes.some(node => node.id === "release" && node.text === "Friday")).toBe(true);
    expect(result.after.graph.nodes.some(node => node.type === "assistant_output" && node.text === "Recorded.")).toBe(true);
  });

  it.each([
    "not valid operations",
    '{"ops":[{"op":"add_edge","from":"missing","to":"user_input_1","type":"supports"}]}',
    '{"ops":[{"op":"call_tool","tool":"read_file","args":{"file_path":"private"}}]}',
    '{"ops":[{"op":"spawn_worker","id":"worker","objective":"disabled"}]}'
  ])("rejects invalid, tool and worker transactions without a retry: %s", async text => {
    let frame: GraphFrame | undefined;
    let snapshot: GraphFrame | undefined;
    const complete = vi.fn<Model["complete"]>(async input => {
      frame = input.frame;
      snapshot = structuredClone(frame);
      return { text };
    });
    await expect(inspectPrimitiveTask("Inspect only", { complete, async *stream() {} })).rejects.toThrow();
    expect(complete).toHaveBeenCalledOnce();
    expect(frame).toEqual(snapshot);
  });

  it("rejects an empty task before invoking a model", async () => {
    const complete = vi.fn<Model["complete"]>();
    await expect(inspectPrimitiveTask(" \n", { complete, async *stream() {} })).rejects.toThrow("non-empty task");
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not retry model failures", async () => {
    const failure = new Error("Model unavailable");
    const complete = vi.fn<Model["complete"]>().mockRejectedValue(failure);
    await expect(inspectPrimitiveTask("Inspect only", { complete, async *stream() {} })).rejects.toBe(failure);
    expect(complete).toHaveBeenCalledOnce();
  });
});
