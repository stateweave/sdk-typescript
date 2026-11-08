import { readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { getWorkspaceEditingCases, type WorkspaceEditingCase } from "../eval/workspace-editing-v1/grader.mjs";
import {
  assertIsolatedWorkspaces,
  assertMatchedEndpoint,
  captureEpisode,
  createEvaluationRoot,
  materializeWorkspace,
  runGraphEpisode,
  runMessagesEpisode,
  type MessagesEntry,
  type MessagesModel
} from "../eval/workspace-editing-v1/runner.js";
import type { Model, ModelInput, ModelOutput, ModelToken } from "../src/llm/model.js";

const offlineLimits = { maxIterationsPerTurn: 12, maxPromptTokens: 64_000 } as const;

it("runs approved multi-turn edits through isolated graph and persistent Messages arms", async () => {
  const item = approvedCase("SDKWS-04");
  const root = await createEvaluationRoot();
  const graphDir = path.join(root, "graph");
  const messagesDir = path.join(root, "messages");
  try {
    await materializeWorkspace(item, graphDir, root);
    await materializeWorkspace(item, messagesDir, root);
    await assertIsolatedWorkspaces(graphDir, messagesDir);

    const states = cardStates();
    const graph = await runGraphEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: graphDir,
      model: new SequenceGraphModel(states.flatMap((content) => [graphWrite("fixtures/cards.json", content), 'SWX/1\n@final "Turn complete."'])),
      ...offlineLimits
    });
    const messagesModel = new SequenceMessagesModel(states.flatMap((content) => [messagesWrite("fixtures/cards.json", content), "FINAL_ANSWER: Turn complete."]));
    const messages = await runMessagesEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: messagesDir,
      model: messagesModel,
      ...offlineLimits
    });

    assertMatchedEndpoint(graph, messages, { provider: "mock", model: "mock-shared-v1" });
    expect(() => assertMatchedEndpoint(graph, messages, { provider: "mock", model: "wrong-model" })).toThrow(/endpoint mismatch/);
    expect(graph.grade.grade.taskOutcome).toBe(true);
    expect(messages.grade.grade.taskOutcome).toBe(true);
    expect(graph.turns).toHaveLength(4);
    expect(graph.frame.graph.nodes.filter((node) => node.type === "user_input")).toHaveLength(4);
    expect(messages.calls).toHaveLength(8);
    expect(messages.messages.filter((entry) => entry.role === "user" && item.turns.includes(entry.content))).toHaveLength(4);
    expect(messagesModel.inputs.at(-1)?.messages.some((entry) => entry.content === item.turns[0])).toBe(true);
    expect(messagesModel.inputs.at(-1)?.messages.filter((entry) => entry.content.startsWith("TOOL_RESULT "))).toHaveLength(4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps file-only no-op evidence hidden until each arm reads the workspace", async () => {
  const item = approvedCase("SDKWS-03");
  const root = await createEvaluationRoot();
  const graphDir = path.join(root, "graph");
  const messagesDir = path.join(root, "messages");
  const answer = JSON.stringify(item.expectedFinalAnswer);
  try {
    await materializeWorkspace(item, graphDir, root);
    await materializeWorkspace(item, messagesDir, root);
    const graphOutputs = item.turns.flatMap((_, index) => [
      "SWX/1\n@tool read_file file_path=settings/manual.json",
      index === item.turns.length - 1
        ? graphFinalRef(answer, true)
        : `SWX/1\n@final "Checked turn ${index + 1}."${index === 0 ? " outcome=already_satisfied" : ""}`
    ]);
    const graphModel = new SequenceGraphModel(graphOutputs);
    const messagesModel = new SequenceMessagesModel(item.turns.flatMap((_, index) => [
      'TOOL_CALL {"name":"read_file","args":{"file_path":"settings/manual.json"}}',
      index === item.turns.length - 1 ? `FINAL_ANSWER: ${answer}` : `FINAL_ANSWER: Checked turn ${index + 1}.`
    ]));

    const graph = await runGraphEpisode({ item, commonInstructions: approvedSpec().commonInstructions, workspaceDir: graphDir, model: graphModel, ...offlineLimits });
    const messages = await runMessagesEpisode({ item, commonInstructions: approvedSpec().commonInstructions, workspaceDir: messagesDir, model: messagesModel, ...offlineLimits });

    assertMatchedEndpoint(graph, messages, { provider: "mock", model: "mock-shared-v1" });
    expect(graph.grade.grade).toMatchObject({ taskOutcome: true, workspaceCorrect: true, answerCorrect: true });
    expect(messages.grade.grade).toMatchObject({ taskOutcome: true, workspaceCorrect: true, answerCorrect: true });
    expect(graph.modelCalls[0]?.input.prompt).not.toContain("canvas-check-q7");
    expect(graph.modelCalls[1]?.input.prompt).toContain("canvas-check-q7");
    expect(messagesModel.inputs[0]?.messages.some((entry) => entry.content.includes("canvas-check-q7"))).toBe(false);
    expect(messagesModel.inputs[1]?.messages.some((entry) => entry.content.includes("canvas-check-q7"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("records serving and protocol failures without manufacturing a task grade", async () => {
  const item = approvedCase("SDKWS-03");
  const root = await createEvaluationRoot();
  const graphDir = path.join(root, "graph");
  const messagesDir = path.join(root, "messages");
  try {
    await materializeWorkspace(item, graphDir, root);
    await materializeWorkspace(item, messagesDir, root);
    const graph = await captureEpisode("graph", item.id, () => runGraphEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: graphDir,
      model: new ThrowingGraphModel(),
      ...offlineLimits
    }));
    const worker = await captureEpisode("graph", item.id, () => runGraphEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: graphDir,
      model: new SequenceGraphModel(['SWX/1\n@worker extra objective="Bypass the call ceiling" focus=user_input_1']),
      ...offlineLimits,
      maxIterationsPerTurn: 1
    }));
    const legacyGraph = await captureEpisode("graph", item.id, () => runGraphEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: graphDir,
      model: new SequenceGraphModel(['{"ops":[{"op":"final","answer":"legacy"}]}']),
      ...offlineLimits,
      maxIterationsPerTurn: 1
    }));
    const malformedGraph = await captureEpisode("graph", item.id, () => runGraphEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: graphDir,
      model: new SequenceGraphModel(["SWX/1\n@ndoe broken"]),
      ...offlineLimits,
      maxIterationsPerTurn: 1
    }));
    const malformedWrite = 'TOOL_CALL {"name":"write_file","args":{"file_path":"settings/manual.json","content":"tampered}}';
    expect(() => JSON.parse(malformedWrite.slice("TOOL_CALL ".length))).toThrow();
    const messages = await captureEpisode("messages", item.id, () => runMessagesEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: messagesDir,
      model: new SequenceMessagesModel([malformedWrite]),
      ...offlineLimits,
      maxIterationsPerTurn: 1
    }));
    const graphCeiling = await captureEpisode("graph", item.id, () => runGraphEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: graphDir,
      model: new SequenceGraphModel(['SWX/1\n@final "unreachable"']),
      maxIterationsPerTurn: 1,
      maxPromptTokens: 1
    }));
    const ceilingModel = new SequenceMessagesModel(["FINAL_ANSWER: unreachable"]);
    const ceiling = await captureEpisode("messages", item.id, () => runMessagesEpisode({
      item,
      commonInstructions: approvedSpec().commonInstructions,
      workspaceDir: messagesDir,
      model: ceilingModel,
      maxIterationsPerTurn: 1,
      maxPromptTokens: 1
    }));

    expect(graph).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "model", evidence: { graphCalls: [{ error: "mock provider unavailable" }] } } });
    expect(worker).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "protocol", evidence: { graphCalls: [{ error: expect.stringContaining("workers are disabled") }] } } });
    expect(legacyGraph).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "protocol", evidence: { graphCalls: [{ error: expect.stringContaining("exact SWX/1 header") }] } } });
    expect(malformedGraph).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "protocol", evidence: { failedGraphTrace: [{ error: expect.stringContaining("Unknown SWX command") }] } } });
    expect(messages).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "protocol", evidence: { messageCalls: [{ action: "invalid" }] } } });
    expect(graphCeiling).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "runtime" } });
    expect(ceiling).toMatchObject({ status: "operational_failure", grade: null, failure: { stage: "runtime", evidence: { messageCalls: [{ action: "error" }] } } });
    expect(ceilingModel.inputs).toHaveLength(0);
    expect(await readFile(path.join(messagesDir, "settings/manual.json"), "utf8")).toBe(item.initialFiles["settings/manual.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects identical or nested arm workspaces", async () => {
  const root = await createEvaluationRoot();
  const nested = path.join(root, "nested");
  const spoofedRoot = `${root}-link`;
  try {
    await expect(materializeWorkspace(approvedCase("SDKWS-03"), root, root)).rejects.toThrow(/direct child of its disposable root/);
    await symlink(root, spoofedRoot, "dir");
    await expect(materializeWorkspace(approvedCase("SDKWS-03"), path.join(spoofedRoot, "graph"), spoofedRoot)).rejects.toThrow(/real directory created by createEvaluationRoot/);
    await materializeWorkspace(approvedCase("SDKWS-03"), nested, root);
    await expect(assertIsolatedWorkspaces(root, nested)).rejects.toThrow(/must be separate/);
  } finally {
    await rm(spoofedRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

function approvedSpec() {
  return getWorkspaceEditingCases();
}

function approvedCase(id: string): WorkspaceEditingCase {
  const item = approvedSpec().cases.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing approved case ${id}`);
  return item;
}

function cardStates(): string[] {
  return [
    { cards: [{ id: "left", label: "Draft", color: "slate" }, { id: "right", label: "Ready", color: "slate" }], selection: "right" },
    { cards: [{ id: "left", label: "Draft", color: "teal" }, { id: "right", label: "Ready", color: "slate" }], selection: "right" },
    { cards: [{ id: "left", label: "Draft", color: "teal" }, { id: "right", label: "Ready", color: "slate" }], selection: "left" },
    { cards: [{ id: "left", label: "Review", color: "teal" }, { id: "right", label: "Ready", color: "slate" }], selection: "left" }
  ].map((value) => `${JSON.stringify(value, null, 2)}\n`);
}

function graphWrite(filePath: string, content: string): string {
  return ["SWX/1", `@tool write_file file_path=${filePath} content_ref=content`, "<<<content:application/json", content.trimEnd(), ">>>"].join("\n");
}

function graphFinalRef(answer: string, alreadySatisfied = false): string {
  return ["SWX/1", `@final_ref answer${alreadySatisfied ? " outcome=already_satisfied" : ""}`, "<<<answer:application/json", answer, ">>>"].join("\n");
}

function messagesWrite(filePath: string, content: string): string {
  return `TOOL_CALL ${JSON.stringify({ name: "write_file", args: { file_path: filePath, content } })}`;
}

class SequenceGraphModel implements Model {
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async complete(_input: ModelInput): Promise<ModelOutput> {
    return { text: this.next() };
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    yield { type: "metadata", metadata: { provider: "mock", model: "mock-shared-v1", usage: { input_tokens: 10, output_tokens: 10 } } };
    yield { type: "token", token: this.next() };
    yield { type: "metadata", metadata: { provider: "mock", stopReason: "end_turn", usage: { output_tokens: 10 } } };
  }

  private next(): string {
    const output = this.outputs[this.index++];
    if (output === undefined) throw new Error("SequenceGraphModel exhausted");
    return output;
  }
}

class ThrowingGraphModel implements Model {
  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new Error("mock provider unavailable");
  }

  async *stream(_input: ModelInput): AsyncIterable<ModelToken> {
    throw new Error("mock provider unavailable");
  }
}

class SequenceMessagesModel implements MessagesModel {
  readonly inputs: Array<{ system: string; messages: MessagesEntry[] }> = [];
  private index = 0;

  constructor(private readonly outputs: string[]) {}

  async complete(input: { system: string; messages: MessagesEntry[] }): Promise<{ text: string; provider: string; model: string; stopReason: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
    this.inputs.push(structuredClone(input));
    const text = this.outputs[this.index++];
    if (text === undefined) throw new Error("SequenceMessagesModel exhausted");
    return { text, provider: "mock", model: "mock-shared-v1", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
  }
}
