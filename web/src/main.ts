import type { GraphFrame, GraphOp, StateGraph, TraceStep } from "../../src/core/types.js";
import "./styles.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };

type StateWeavePayload = {
  inputFrame?: GraphFrame;
  frameAfter?: GraphFrame;
  output: string;
  trace: TraceStep[];
  graph: StateGraph;
};

type StateWeaveResponse = { stateweave: StateWeavePayload };
type CompareResponse = StateWeaveResponse & {
  traditional: {
    messages: ModelMessage[];
    rawModelInput: string;
    output: string;
    history: ChatMessage[];
  };
};

type PageName = "state" | "ab";

let activePage: PageName = location.hash === "#ab" ? "ab" : "state";
let stateFrame: GraphFrame | undefined;
let abStateFrame: GraphFrame | undefined;
let abRegularHistory: ChatMessage[] = [];
let stateRunning = false;
let abRunning = false;
let copyCounter = 0;

const copyPayloads = new Map<string, string>();
const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const stateTab = element<HTMLButtonElement>("state-tab");
const abTab = element<HTMLButtonElement>("ab-tab");
const statePage = element<HTMLElement>("state-page");
const abPage = element<HTMLElement>("ab-page");
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
const abForm = element<HTMLFormElement>("ab-composer");
const abInput = element<HTMLTextAreaElement>("ab-input");
const abSend = element<HTMLButtonElement>("ab-send");
const abStatus = element<HTMLElement>("ab-status");
const abResults = element<HTMLElement>("ab-results");

setActivePage(activePage, false);
void loadHealth();

stateTab.addEventListener("click", () => setActivePage("state"));
abTab.addEventListener("click", () => setActivePage("ab"));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendStateWeaveMessage();
});
abForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runAbTest();
});
reset.addEventListener("click", () => {
  if (activePage === "state") resetStateWeaveChat();
  else resetAbTests();
});
input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendStateWeaveMessage();
  }
});
abInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void runAbTest();
  }
});
abResults.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  const button = target?.closest<HTMLButtonElement>("button[data-copy-id]");
  if (!button?.dataset.copyId) return;
  const value = copyPayloads.get(button.dataset.copyId);
  if (value) void copyText(value, button);
});

function setActivePage(page: PageName, updateHash = true): void {
  activePage = page;
  const isState = page === "state";
  stateTab.classList.toggle("active", isState);
  stateTab.setAttribute("aria-selected", String(isState));
  abTab.classList.toggle("active", !isState);
  abTab.setAttribute("aria-selected", String(!isState));
  statePage.hidden = !isState;
  statePage.classList.toggle("active", isState);
  abPage.hidden = isState;
  abPage.classList.toggle("active", !isState);
  reset.textContent = isState ? "Reset" : "Reset A/B";
  if (updateHash) history.replaceState(null, "", isState ? location.pathname : "#ab");
  (isState ? input : abInput).focus();
}

async function sendStateWeaveMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || stateRunning) return;

  stateRunning = true;
  send.disabled = true;
  reset.disabled = true;
  input.value = "";
  status.textContent = "Thinking…";
  clearEmptyState(chat);
  appendUser(text);
  const pending = appendPendingStateWeave();

  try {
    const result = await runStateWeave(text, stateFrame);
    stateFrame = result.stateweave.frameAfter;
    pending.remove();
    appendAssistant(result.stateweave.output);
    renderStateWeave(result.stateweave);
    status.textContent = `Done · StateGraph ${result.stateweave.graph.nodes.length} nodes / ${result.stateweave.graph.edges.length} edges`;
  } catch (error) {
    pending.remove();
    appendError(chat, error instanceof Error ? error.message : String(error));
    status.textContent = "Failed.";
  } finally {
    stateRunning = false;
    send.disabled = false;
    reset.disabled = false;
    input.focus();
  }
}

async function runAbTest(): Promise<void> {
  const text = abInput.value.trim();
  if (!text || abRunning) return;

  abRunning = true;
  abSend.disabled = true;
  reset.disabled = true;
  abInput.value = "";
  abStatus.textContent = "Running A/B…";
  clearEmptyState(abResults);
  const pending = appendAbPending(text);

  try {
    const result = await compareStateWeave(text, abStateFrame, abRegularHistory);
    abStateFrame = result.stateweave.frameAfter;
    abRegularHistory = result.traditional.history;
    pending.remove();
    appendAbResult(text, result.traditional.output, result.stateweave.output, result.stateweave.graph);
    abStatus.textContent = `Done · StateGraph ${result.stateweave.graph.nodes.length} nodes / ${result.stateweave.graph.edges.length} edges`;
  } catch (error) {
    pending.remove();
    appendError(abResults, error instanceof Error ? error.message : String(error));
    abStatus.textContent = "Failed.";
  } finally {
    abRunning = false;
    abSend.disabled = false;
    reset.disabled = false;
    abInput.focus();
  }
}

async function runStateWeave(text: string, frame: GraphFrame | undefined): Promise<StateWeaveResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame })
  });

  const body = (await response.json()) as StateWeaveResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
  return body as StateWeaveResponse;
}

async function compareStateWeave(text: string, frame: GraphFrame | undefined, messages: ChatMessage[]): Promise<CompareResponse> {
  const response = await fetch(`${apiBase}/api/stateweave/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text, frame, messages })
  });

  const body = (await response.json()) as CompareResponse | { error?: string };
  if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
  return body as CompareResponse;
}

function renderStateWeave(result: StateWeavePayload): void {
  stateInput.textContent = result.inputFrame ? compactFrame(result.inputFrame) : "No GraphFrame captured.";
  stateOutput.textContent = formatStateOutput(result.trace, result.output);
  renderGraph(result.graph);
}

async function loadHealth(): Promise<void> {
  const response = await fetch(`${apiBase}/api/health`).catch(() => undefined);
  const health = response?.ok ? ((await response.json()) as { provider?: string }) : undefined;
  provider.textContent = health?.provider ? `Provider: ${health.provider}` : "Provider unavailable";
}

function resetStateWeaveChat(): void {
  stateFrame = undefined;
  chat.innerHTML = `<div class="empty-state"><h2>Ask anything.</h2><p>StateWeave keeps one growing StateGraph rooted at <code>system_root</code>, then compiles a GraphFrame for the model each turn.</p></div>`;
  stateInput.textContent = "No turn yet.";
  stateOutput.textContent = "No output yet.";
  graph.className = "graph-empty";
  graph.textContent = "No graph yet.";
  status.textContent = "Reset.";
  input.focus();
}

function resetAbTests(): void {
  abStateFrame = undefined;
  abRegularHistory = [];
  copyPayloads.clear();
  abResults.innerHTML = `<div class="empty-state compact"><h2>No A/B runs yet.</h2><p>Run a prompt to see regular messages and StateWeave responses side by side.</p></div>`;
  abStatus.textContent = "Reset.";
  abInput.focus();
}

function appendUser(text: string): void {
  chat.insertAdjacentHTML("beforeend", `<div class="message user"><div>${escapeHtml(text)}</div></div>`);
  scrollChat(chat);
}

function appendAssistant(stateweave: string): void {
  chat.insertAdjacentHTML(
    "beforeend",
    `<article class="answer state-answer assistant-response">
      <span>StateWeave</span>
      ${responseHtml(stateweave)}
    </article>`
  );
  scrollChat(chat);
}

function appendPendingStateWeave(): HTMLElement {
  const item = document.createElement("article");
  item.className = "answer pending assistant-response";
  item.innerHTML = `<span>StateWeave</span><p>Compiling GraphFrame and growing the StateGraph…</p>`;
  chat.append(item);
  scrollChat(chat);
  return item;
}

function appendAbPending(prompt: string): HTMLElement {
  const item = document.createElement("article");
  item.className = "ab-run pending";
  item.innerHTML = `
    <div class="ab-run-header">
      <div>
        <p class="eyebrow">Prompt</p>
        <h3>${escapeHtml(shorten(prompt, 96))}</h3>
      </div>
      <span class="badge">Running both paths…</span>
    </div>
    <div class="ab-answer-grid">
      <article class="ab-answer regular"><h4>Regular messages</h4><p>Waiting…</p></article>
      <article class="ab-answer state"><h4>StateWeave</h4><p>Waiting…</p></article>
    </div>`;
  abResults.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

function appendAbResult(prompt: string, regular: string, stateweave: string, value: StateGraph): void {
  const regularCopy = registerCopy(regular);
  const stateCopy = registerCopy(stateweave);
  const bothCopy = registerCopy([`Prompt:\n${prompt}`, `Regular messages:\n${regular}`, `StateWeave:\n${stateweave}`].join("\n\n---\n\n"));

  abResults.insertAdjacentHTML(
    "beforeend",
    `<article class="ab-run">
      <div class="ab-run-header">
        <div>
          <p class="eyebrow">Prompt</p>
          <h3>${escapeHtml(prompt)}</h3>
          <p class="ab-meta">StateGraph ${value.nodes.length} nodes / ${value.edges.length} edges</p>
        </div>
        <button class="button secondary small-button" type="button" data-copy-id="${bothCopy}">Copy both</button>
      </div>
      <div class="ab-answer-grid">
        <article class="ab-answer regular">
          <div class="ab-answer-header">
            <h4>Regular messages</h4>
            <button class="button secondary small-button" type="button" data-copy-id="${regularCopy}">Copy</button>
          </div>
          ${responseHtml(regular)}
        </article>
        <article class="ab-answer state">
          <div class="ab-answer-header">
            <h4>StateWeave</h4>
            <button class="button secondary small-button" type="button" data-copy-id="${stateCopy}">Copy</button>
          </div>
          ${responseHtml(stateweave)}
        </article>
      </div>
    </article>`
  );
  abResults.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function appendError(container: HTMLElement, message: string): void {
  container.insertAdjacentHTML("beforeend", `<div class="message error"><div>${escapeHtml(message)}</div></div>`);
  scrollChat(container);
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
  return ops.map(formatOp).join("\n");
}

function formatOp(op: GraphOp): string {
  if (op.op === "add_node") return `@node ${op.node.id} ${op.node.type} "${shorten(op.node.text, 96)}"`;
  if (op.op === "add_edge") return `@edge ${op.from} ${op.type} ${op.to}`;
  if (op.op === "update_node") return `@update ${op.id}`;
  if (op.op === "focus") return `@focus "${op.currentFocus}"`;
  if (op.op === "call_tool") return `@tool ${op.tool}`;
  if (op.op === "final") return op.artifactId ? `@final ${op.artifactId}` : `@final "${shorten(op.answer, 120)}"`;
  return "@unknown";
}

function responseHtml(value: string): string {
  const artifact = extractPreviewArtifact(value);
  if (!artifact) return `<p>${escapeHtml(value)}</p>`;
  return `
    <div class="artifact-preview">
      <iframe sandbox="" srcdoc="${escapeAttribute(artifact)}" title="Generated artifact preview"></iframe>
    </div>
    <pre class="artifact-source">${escapeHtml(value)}</pre>`;
}

function extractPreviewArtifact(value: string): string | undefined {
  const fenced = value.match(/```(?:svg|html|xml)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || value.trim();
  if (/^(?:<!doctype\s+html|<html[\s>]|<svg[\s>])/i.test(candidate)) return candidate;
  return undefined;
}

function registerCopy(value: string): string {
  const id = `copy_${++copyCounter}`;
  copyPayloads.set(id, value);
  return id;
}

async function copyText(value: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "Copy";
  try {
    await writeClipboard(value);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  } finally {
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function clearEmptyState(container: HTMLElement): void {
  const empty = container.querySelector(".empty-state");
  if (empty) empty.remove();
}

function scrollChat(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
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

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
