import type { GraphFrame, GraphOp, StateGraph, TraceStep } from "../../src/core/types.js";
import "./styles.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };
type CompareResponse = {
  traditional: {
    messages: ModelMessage[];
    output: string;
    history: ChatMessage[];
  };
  stateweave: {
    inputFrame: GraphFrame;
    frameAfter: GraphFrame;
    output: string;
    trace: TraceStep[];
    graph: StateGraph;
  };
};

let stateFrame: GraphFrame | undefined;
let regularHistory: ChatMessage[] = [];
let running = false;

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const chat = element<HTMLElement>("chat");
const form = element<HTMLFormElement>("composer");
const input = element<HTMLTextAreaElement>("input");
const send = element<HTMLButtonElement>("send");
const reset = element<HTMLButtonElement>("reset");
const status = element<HTMLElement>("status");
const provider = element<HTMLElement>("provider");
const regularInput = element<HTMLElement>("regular-input");
const regularOutput = element<HTMLElement>("regular-output");
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
    const result = await compare(text);
    stateFrame = result.stateweave.frameAfter;
    regularHistory = result.traditional.history;
    pending.remove();
    appendAssistantPair(result.traditional.output, result.stateweave.output);
    renderComparison(result);
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

async function compare(text: string): Promise<CompareResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame: stateFrame, messages: regularHistory })
  });

  const body = (await response.json()) as CompareResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
  return body as CompareResponse;
}

function renderComparison(result: CompareResponse): void {
  regularInput.textContent = formatMessages(result.traditional.messages);
  regularOutput.textContent = result.traditional.output;
  stateInput.textContent = compactFrame(result.stateweave.inputFrame);
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
  regularHistory = [];
  chat.innerHTML = `<div class="empty-state"><h2>Ask anything.</h2><p>Each turn compares regular chat messages with StateWeave GraphFrame state.</p></div>`;
  regularInput.textContent = "No turn yet.";
  regularOutput.textContent = "No output yet.";
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

function appendAssistantPair(regular: string, stateweave: string): void {
  chat.insertAdjacentHTML(
    "beforeend",
    `<div class="assistant-pair">
      <article class="answer regular-answer">
        <span>Regular messages</span>
        <p>${escapeHtml(regular)}</p>
      </article>
      <article class="answer state-answer">
        <span>StateWeave</span>
        <p>${escapeHtml(stateweave)}</p>
      </article>
    </div>`
  );
  scrollChat();
}

function appendPending(): HTMLElement {
  const item = document.createElement("div");
  item.className = "assistant-pair pending";
  item.innerHTML = `<article class="answer"><span>Running comparison…</span><p>Calling regular messages and StateWeave.</p></article>`;
  chat.append(item);
  scrollChat();
  return item;
}

function appendError(message: string): void {
  chat.insertAdjacentHTML("beforeend", `<div class="message error"><div>${escapeHtml(message)}</div></div>`);
  scrollChat();
}

function renderGraph(value: StateGraph): void {
  graph.className = "graph-list";
  graph.innerHTML = `
    <div class="graph-summary">${value.nodes.length} nodes · ${value.edges.length} edges</div>
    ${value.nodes.map((node) => `
      <article class="node">
        <div><strong>${escapeHtml(node.id)}</strong><span>${escapeHtml(node.type)}</span></div>
        <p>${escapeHtml(node.text)}</p>
      </article>`).join("")}
  `;
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

function formatMessages(messages: ModelMessage[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join("\n\n---\n\n");
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}
