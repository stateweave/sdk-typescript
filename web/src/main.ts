import { createInitialGraphFrame } from "../../src/core/graph.js";
import { parseAndValidateOps } from "../../src/core/validateOps.js";
import { applyOps } from "../../src/core/applyOps.js";
import type { GraphFrame } from "../../src/core/types.js";
import "./styles.css";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing inspector element: ${id}`);
  return node as T;
}

const taskForm = element<HTMLFormElement>("task-form");
const taskInput = element<HTMLTextAreaElement>("task");
const opsInput = element<HTMLTextAreaElement>("ops");
const applyButton = element<HTMLButtonElement>("apply");
const frameOutput = element<HTMLPreElement>("frame-output");
const graphOutput = element<HTMLPreElement>("graph-output");
const graphSummary = element<HTMLParagraphElement>("graph-summary");
const status = element<HTMLParagraphElement>("status");
const errorOutput = element<HTMLParagraphElement>("error");

const sampleEnvelope = {
  ops: [
    {
      op: "add_node",
      node: { id: "task_1", type: "task", text: "A manually recorded task", status: "active" }
    },
    { op: "add_edge", from: "task_1", to: "user_input_1", type: "addresses" }
  ]
};

let currentFrame: GraphFrame | undefined;
let transactions = 0;
opsInput.value = serialize(sampleEnvelope);

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function clearError(): void {
  errorOutput.textContent = "";
  errorOutput.hidden = true;
}

function showError(error: unknown): void {
  errorOutput.textContent = `Not applied. State unchanged. ${error instanceof Error ? error.message : String(error)}`;
  errorOutput.hidden = false;
}

function renderGraph(frame: GraphFrame): void {
  graphOutput.textContent = serialize(frame.graph);
  graphSummary.textContent = `${frame.graph.nodes.length} nodes · ${frame.graph.edges.length} edges · ${transactions} transaction${transactions === 1 ? "" : "s"}`;
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearError();
  const task = taskInput.value.trim();
  if (!task) {
    showError(new Error("Enter a non-empty task first."));
    taskInput.focus();
    return;
  }
  try {
    const next = createInitialGraphFrame({ objective: task, input: task, availableActions: [] });
    currentFrame = next;
    transactions = 0;
    frameOutput.textContent = serialize(next);
    renderGraph(next);
    opsInput.value = serialize(sampleEnvelope);
    opsInput.disabled = false;
    applyButton.disabled = false;
    status.textContent = "Initial GraphFrame built. Edit the sample GraphOps, then apply a transaction. No model was called.";
  } catch (error) {
    showError(error);
  }
});

applyButton.addEventListener("click", () => {
  clearError();
  if (!currentFrame) return;
  try {
    const envelope: unknown = JSON.parse(opsInput.value);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !("ops" in envelope)) {
      throw new Error('Expected a JSON object with an "ops" array.');
    }
    const ops = parseAndValidateOps(opsInput.value);
    if (ops.some((op) => op.op === "call_tool" || op.op === "spawn_worker")) {
      throw new Error("Tool and worker operations are disabled in this manual inspector.");
    }
    const next = applyOps(currentFrame, ops);
    currentFrame = next;
    transactions += 1;
    renderGraph(next);
    status.textContent = `Transaction ${transactions} applied: ${ops.length} validated operation${ops.length === 1 ? "" : "s"}. Initial GraphFrame snapshot preserved.`;
  } catch (error) {
    showError(error);
  }
});
