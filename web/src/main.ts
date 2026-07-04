import type { GraphFrame, GraphOp, StateGraph, TraceStep } from "../../src/core/types.js";
import "./styles.css";

type StateWeaveResponse = {
  stateweave: {
    inputFrame?: GraphFrame;
    frameAfter?: GraphFrame;
    output: string;
    trace: TraceStep[];
    graph: StateGraph;
  };
};

let stateFrame: GraphFrame | undefined;
let running = false;

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const chat = element<HTMLElement>("chat");
const form = element<HTMLFormElement>("composer");
const input = element<HTMLTextAreaElement>("input");
const send = element<HTMLButtonElement>("send");
const reset = element<HTMLButtonElement>("reset");
const status = element<HTMLElement>("status");
const provider = element<HTMLElement>("provider");
const stateInput = element<HTMLElement>("state-input");
const stateOutput = element<HTMLElement>("state-output");
const graph = element<HTMLElement>("graph");

void loadHealth();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage();
});
reset.addEventListener("click", resetChat);
input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendMessage();
  }
});

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || running) return;

  running = true;
  send.disabled = true;
  reset.disabled = true;
  input.value = "";
  status.textContent = "Thinking…";
  clearEmptyState();
  appendUser(text);
  const pending = appendPending();

  try {
    const result = await runStateWeave(text);
    stateFrame = result.stateweave.frameAfter;
    pending.remove();
    appendAssistant(result.stateweave.output);
    renderStateWeave(result);
    status.textContent = `Done · StateGraph ${result.stateweave.graph.nodes.length} nodes / ${result.stateweave.graph.edges.length} edges`;
  } catch (error) {
    pending.remove();
    appendError(error instanceof Error ? error.message : String(error));
    status.textContent = "Failed.";
  } finally {
    running = false;
    send.disabled = false;
    reset.disabled = false;
    input.focus();
  }
}

async function runStateWeave(text: string): Promise<StateWeaveResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame: stateFrame })
  });

  const body = (await response.json()) as StateWeaveResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
  return body as StateWeaveResponse;
}

function renderStateWeave(result: StateWeaveResponse): void {
  stateInput.textContent = result.stateweave.inputFrame ? compactFrame(result.stateweave.inputFrame) : "No GraphFrame captured.";
  stateOutput.textContent = formatStateOutput(result.stateweave.trace, result.stateweave.output);
  renderGraph(result.stateweave.graph);
}

async function loadHealth(): Promise<void> {
  const response = await fetch(`${apiBase}/api/health`).catch(() => undefined);
  const health = response?.ok ? ((await response.json()) as { provider?: string }) : undefined;
  provider.textContent = health?.provider ? `Provider: ${health.provider}` : "Provider unavailable";
}

function resetChat(): void {
  stateFrame = undefined;
  chat.innerHTML = `<div class="empty-state"><h2>Ask anything.</h2><p>StateWeave keeps one growing StateGraph rooted at <code>system_root</code>, then compiles a GraphFrame for the model each turn.</p></div>`;
  stateInput.textContent = "No turn yet.";
  stateOutput.textContent = "No output yet.";
  graph.className = "graph-empty";
  graph.textContent = "No graph yet.";
  status.textContent = "Reset.";
  input.focus();
}

function appendUser(text: string): void {
  chat.insertAdjacentHTML("beforeend", `<div class="message user"><div>${escapeHtml(text)}</div></div>`);
  scrollChat();
}

function appendAssistant(stateweave: string): void {
  chat.insertAdjacentHTML(
    "beforeend",
    `<article class="answer state-answer assistant-response">
      <span>StateWeave</span>
      <p>${escapeHtml(stateweave)}</p>
    </article>`
  );
  scrollChat();
}

function appendPending(): HTMLElement {
  const item = document.createElement("article");
  item.className = "answer pending assistant-response";
  item.innerHTML = `<span>StateWeave</span><p>Compiling GraphFrame and growing the StateGraph…</p>`;
  chat.append(item);
  scrollChat();
  return item;
}

function appendError(message: string): void {
  chat.insertAdjacentHTML("beforeend", `<div class="message error"><div>${escapeHtml(message)}</div></div>`);
  scrollChat();
}

function renderGraph(value: StateGraph): void {
  const layout = graphLayout(value);
  const turnCount = value.nodes.filter((node) => node.type === "user_input").length;

  graph.className = "graph-visual";
  graph.innerHTML = `
    <div class="graph-summary">
      <strong>Turn ${turnCount}</strong>
      <span>${value.nodes.length} nodes · ${value.edges.length} edges</span>
    </div>
    <svg class="graph-svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="StateGraph visualization">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      <g class="edges">
        ${layout.edges.map((edge) => edge.fromNode && edge.toNode ? `
          <g class="edge-line">
            <line x1="${edge.fromNode.x}" y1="${edge.fromNode.y}" x2="${edge.toNode.x}" y2="${edge.toNode.y}" marker-end="url(#arrow)"></line>
            <text x="${(edge.fromNode.x + edge.toNode.x) / 2}" y="${(edge.fromNode.y + edge.toNode.y) / 2 - 8}">${escapeHtml(edge.type)}</text>
          </g>` : "").join("")}
      </g>
      <g class="nodes">
        ${layout.nodes.map((node) => `
          <g class="graph-node-vis ${escapeHtml(node.type)}" transform="translate(${node.x} ${node.y})">
            <circle r="28"></circle>
            <text class="node-id" y="-2">${escapeHtml(shorten(node.id, 18))}</text>
            <text class="node-type" y="15">${escapeHtml(node.type)}</text>
          </g>`).join("")}
      </g>
    </svg>
    <div class="node-details">
      ${value.nodes.map((node) => `
        <article class="node-detail">
          <div><strong>${escapeHtml(node.id)}</strong><span>${escapeHtml(node.type)}</span></div>
          <p>${escapeHtml(node.text)}</p>
        </article>`).join("")}
    </div>
  `;
}

function graphLayout(value: StateGraph): {
  width: number;
  height: number;
  nodes: Array<StateGraph["nodes"][number] & { x: number; y: number }>;
  edges: Array<StateGraph["edges"][number] & { fromNode?: StateGraph["nodes"][number] & { x: number; y: number }; toNode?: StateGraph["nodes"][number] & { x: number; y: number } }>;
} {
  const width = 920;
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value.nodes.length || 1))));
  const columnWidth = width / columns;
  const rowHeight = 140;
  const rows = Math.max(1, Math.ceil(value.nodes.length / columns));
  const height = Math.max(360, rows * rowHeight + 80);

  const nodes = value.nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...node,
      x: Math.round(columnWidth / 2 + column * columnWidth),
      y: 80 + row * rowHeight
    };
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = value.edges.map((edge) => ({ ...edge, fromNode: nodeMap.get(edge.from), toNode: nodeMap.get(edge.to) }));
  return { width, height, nodes, edges };
}

function compactFrame(frame: GraphFrame): string {
  const lines = [
    `objective: ${frame.frame.objective}`,
    `currentFocus: ${frame.frame.currentFocus}`,
    `nextExpectedOutput: ${frame.frame.nextExpectedOutput}`,
    `activeConstraints: ${frame.frame.activeConstraints.length ? frame.frame.activeConstraints.join("; ") : "none"}`,
    "",
    "graph:",
    ...frame.graph.nodes.map((node) => `- ${node.id} [${node.type}] ${node.text}`),
    ...frame.graph.edges.map((edge) => `- ${edge.from} -${edge.type}-> ${edge.to}`)
  ];
  return lines.join("\n");
}

function formatStateOutput(trace: TraceStep[], finalAnswer: string): string {
  const parts = trace.map((step) => [
    `step ${step.step} raw model output:`,
    step.rawModelOutput,
    "",
    `step ${step.step} parsed GraphOps:`,
    formatOps(step.parsedOps)
  ].join("\n"));
  return [...parts, "", "final answer:", finalAnswer].join("\n");
}

function formatOps(ops: GraphOp[]): string {
  return ops.map((op) => JSON.stringify(op)).join("\n");
}

function clearEmptyState(): void {
  const empty = chat.querySelector(".empty-state");
  if (empty) empty.remove();
}

function scrollChat(): void {
  chat.scrollTop = chat.scrollHeight;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}

function shorten(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}
