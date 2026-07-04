import { serializeGraphFrame } from "../../src/core/serialize.js";
import type { GraphFrame, GraphOp, StateGraph, StateWeaveStreamEvent } from "../../src/core/types.js";
import { graphToMermaid } from "../../src/core/visualize.js";
import "./styles.css";

type ApiEvent = StateWeaveStreamEvent | { type: "error"; message: string };

let sessionFrame: GraphFrame | undefined;
let running = false;

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const task = element<HTMLTextAreaElement>("task");
const sample = element<HTMLSelectElement>("sample");
const runButton = element<HTMLButtonElement>("run");
const resetButton = element<HTMLButtonElement>("reset");
const status = element<HTMLElement>("status");
const trace = element<HTMLElement>("trace");
const framePanel = element<HTMLElement>("frame");
const graphPanel = element<HTMLElement>("graph");
const mermaidPanel = element<HTMLElement>("mermaid");
const opsPanel = element<HTMLElement>("ops");
const promptPanel = element<HTMLElement>("prompt");
const providerPanel = element<HTMLElement>("provider");
const showPrompt = element<HTMLInputElement>("show-prompt");
const showFull = element<HTMLInputElement>("show-full");
const showMermaid = element<HTMLInputElement>("show-mermaid");
const maxSteps = element<HTMLInputElement>("max-steps");

task.value = sample.value;
void loadHealth();

sample.addEventListener("change", () => {
  task.value = sample.value;
  task.focus();
});
runButton.addEventListener("click", () => void runTask());
resetButton.addEventListener("click", resetMemory);
task.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runTask();
});

async function runTask(): Promise<void> {
  const input = task.value.trim();
  if (!input || running) return;

  running = true;
  runButton.disabled = true;
  resetButton.disabled = true;
  status.textContent = "Running…";
  trace.classList.remove("empty");
  trace.innerHTML = "";
  appendTrace("user", "User input", input);

  let streamText = "";

  try {
    for await (const event of streamRun(input)) {
      if (event.type === "error") throw new Error(event.message);

      if (event.type === "frame" && event.phase === "before") {
        appendTrace("frame", `Step ${event.step} · model in`, compactFrame(event.frame));
        promptPanel.textContent = showPrompt.checked ? serializeGraphFrame(event.frame) : "Enable “Prompt” and run again to inspect the exact GraphFrame prompt.";
      }

      if (event.type === "token") {
        streamText += event.token;
        upsertTrace("stream", `Step ${event.step} · model out stream`, streamText);
      }

      if (event.type === "ops") {
        streamText = "";
        opsPanel.textContent = JSON.stringify(event.ops, null, 2);
        appendTrace("ops", `Step ${event.step} · parsed GraphOps`, formatOps(event.ops));
      }

      if (event.type === "frame" && event.phase === "after") {
        sessionFrame = event.frame;
        framePanel.textContent = showFull.checked ? JSON.stringify(event.frame, null, 2) : compactFrame(event.frame);
        renderGraph(event.frame.graph);
        mermaidPanel.textContent = showMermaid.checked ? graphToMermaid(event.frame.graph) : "Mermaid hidden.";
        appendTrace("frame", `Step ${event.step} · state after`, compactFrame(event.frame));
      }

      if (event.type === "final") {
        appendTrace("final", "Final answer", event.result.finalAnswer);
        status.textContent = `Done · ${event.result.graph.nodes.length} nodes · ${event.result.trace.length} steps`;
      }
    }
  } catch (error) {
    status.textContent = "Run failed.";
    appendTrace("error", "Error", error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
    runButton.disabled = false;
    resetButton.disabled = false;
  }
}

async function* streamRun(input: string): AsyncIterable<ApiEvent> {
  const response = await fetch(`${apiBase}/api/stateweave/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, frame: sessionFrame, maxSteps: numericMaxSteps() })
  });

  if (!response.ok) throw new Error(`StateWeave API failed (${response.status})`);
  if (!response.body) throw new Error("StateWeave API did not return a stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as ApiEvent;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer) as ApiEvent;
}

async function loadHealth(): Promise<void> {
  const response = await fetch(`${apiBase}/api/health`).catch(() => undefined);
  const health = response?.ok ? ((await response.json()) as { provider?: string }) : undefined;
  providerPanel.textContent = health?.provider ? `Server API ready · ${health.provider}` : "Server API unavailable";
}

function resetMemory(): void {
  sessionFrame = undefined;
  trace.classList.add("empty");
  trace.textContent = "Memory reset. Run a task to start a fresh StateGraph.";
  framePanel.textContent = "No frame yet.";
  graphPanel.className = "graph-empty";
  graphPanel.textContent = "No graph yet.";
  mermaidPanel.textContent = "";
  opsPanel.textContent = "No ops yet.";
  promptPanel.textContent = "Enable “Prompt” and run a task.";
  status.textContent = "Memory reset.";
}

function renderGraph(graph: StateGraph): void {
  graphPanel.className = "graph-view";
  graphPanel.innerHTML = `
    <div class="graph-nodes">
      ${graph.nodes.map((node) => `
        <article class="graph-node ${escapeHtml(node.type)}">
          <div class="node-topline">
            <strong>${escapeHtml(node.id)}</strong>
            <span>${escapeHtml(node.type)}</span>
          </div>
          <p>${escapeHtml(node.text)}</p>
          ${node.status ? `<small>${escapeHtml(node.status)}</small>` : ""}
        </article>
      `).join("")}
    </div>
    <div class="graph-edges">
      <h3>Edges</h3>
      ${graph.edges.length ? graph.edges.map((edge) => `
        <div class="edge"><code>${escapeHtml(edge.from)}</code><span>${escapeHtml(edge.type)}</span><code>${escapeHtml(edge.to)}</code></div>
      `).join("") : `<p>No edges.</p>`}
    </div>
  `;
}

function appendTrace(kind: string, title: string, body: string): void {
  const item = document.createElement("article");
  item.className = `trace-item ${kind}`;
  item.innerHTML = `<h3>${escapeHtml(title)}</h3><pre>${escapeHtml(body)}</pre>`;
  trace.append(item);
  item.scrollIntoView({ block: "nearest" });
}

function upsertTrace(kind: string, title: string, body: string): void {
  const id = `stream-${slug(title)}`;
  let item = document.getElementById(id);
  if (!item) {
    item = document.createElement("article");
    item.id = id;
    item.className = `trace-item ${kind}`;
    item.innerHTML = `<h3>${escapeHtml(title)}</h3><pre></pre>`;
    trace.append(item);
  }
  const pre = item.querySelector("pre");
  if (pre) pre.textContent = body;
}

function compactFrame(frame: GraphFrame): string {
  const lines = [
    `objective: ${frame.frame.objective}`,
    `focus: ${frame.frame.currentFocus}`,
    `next: ${frame.frame.nextExpectedOutput}`,
    `constraints: ${frame.frame.activeConstraints.length ? frame.frame.activeConstraints.join("; ") : "none"}`,
    `graph: ${frame.graph.nodes.length} nodes · ${frame.graph.edges.length} edges`,
    ""
  ];

  for (const node of frame.graph.nodes) {
    const status = node.status ? ` ${node.status}` : "";
    lines.push(`${node.id} [${node.type}]${status} ${node.text}`);
  }

  if (frame.graph.edges.length) {
    lines.push("", "edges");
    for (const edge of frame.graph.edges) lines.push(`${edge.from} -${edge.type}-> ${edge.to}`);
  }

  return lines.join("\n");
}

function formatOps(ops: GraphOp[]): string {
  return ops.map((op) => {
    if (op.op === "add_node") return `add_node ${op.node.id} [${op.node.type}] ${op.node.text}`;
    if (op.op === "add_edge") return `add_edge ${op.from} -${op.type}-> ${op.to}`;
    if (op.op === "update_node") return `update_node ${op.id} ${JSON.stringify(op.patch)}`;
    if (op.op === "focus") return `focus ${op.currentFocus}`;
    if (op.op === "call_tool") return `call_tool ${op.tool} ${JSON.stringify(op.args)}`;
    return `final ${op.answer}`;
  }).join("\n");
}

function numericMaxSteps(): number {
  const value = Number(maxSteps.value);
  if (!Number.isInteger(value) || value < 1) return 5;
  return Math.min(value, 8);
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
