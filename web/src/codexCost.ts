// Codex cost lab: connect your own ChatGPT subscription, pick a model and
// reasoning level, and run the scripted long chat through both arms.
type Choice = { id: string; label: string; isDefault: boolean; defaultThinking: string; thinkingLevels: string[] };
type Pricing = { input: number; cachedInput: number; output: number };
type Totals = { calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; missingUsageCalls: number; costUsd: number; peakInputTokens: number };
type ArmTurn = { status: string; answer?: string; error?: string; ms: number; usage: Totals; check?: { passed: boolean; missing: string[]; forbidden: string[] } };
type Turn = { turn: number; kind: string; prompt: string; arms: { stateweave: ArmTurn; traditional: ArmTurn } };
type Run = { id: string; status: string; model: string; reasoningEffort?: string; turnsPlanned: number; error?: string; turns: Turn[]; totals: { stateweave: Totals; traditional: Totals } };
type Status = { connected: boolean; pending: boolean; busyElsewhere: boolean; error?: string; login?: { verificationUrl: string; userCode: string }; models: Choice[]; defaultPricing: Record<string, Pricing>; scriptTurns: number };

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (value: number) => value.toLocaleString("en-US");
const usd = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`;

export function createCodexCostLab(root: HTMLElement, apiBase: string) {
  let status: Status | undefined;
  let run: Run | null = null;
  let timer: number | undefined;
  let busy = false;
  let notice = "";
  const form = { model: "", thinking: "", turns: 10, pricing: { input: 5, cachedInput: 0.5, output: 30 } as Pricing };

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, { method, cache: "no-store", credentials: "same-origin", ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
    return data;
  }

  function applyModelDefaults(): void {
    const models = status?.models ?? [];
    let choice = models.find((m) => m.id === form.model);
    if (!choice) {
      choice = models.find((m) => m.id === "gpt-5.5") ?? models.find((m) => m.isDefault) ?? models[0];
      form.model = choice?.id ?? "";
      form.thinking = choice?.defaultThinking ?? "";
      const price = choice && (status?.defaultPricing[choice.id] ?? undefined);
      if (price) form.pricing = { ...price };
    }
    if (choice && !choice.thinkingLevels.includes(form.thinking)) form.thinking = choice.defaultThinking;
  }

  async function refresh(): Promise<void> {
    try {
      status = await call<Status>("GET", "/api/codex/status");
      applyModelDefaults();
      run = (await call<{ run: Run | null }>("GET", "/api/codex-bench/state")).run;
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }
    render();
    const live = status?.pending || run?.status === "running";
    if (live) schedule();
  }

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 3000);
  }

  async function act(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    notice = "";
    render();
    try {
      await fn();
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      await refresh();
    }
  }

  function totalsRow(label: string, t: Totals): string {
    return `<tr><th>${label}</th><td>${num(t.calls)}</td><td>${num(t.inputTokens)}</td><td>${num(t.cachedInputTokens)}</td><td>${num(t.outputTokens)}</td><td>${num(t.reasoningTokens)}</td><td>${num(t.peakInputTokens)}</td><td><strong>${usd(t.costUsd)}</strong></td></tr>`;
  }

  function renderRun(r: Run): string {
    const sw = r.totals.stateweave;
    const tr = r.totals.traditional;
    const saving = tr.costUsd > 0 ? (1 - sw.costUsd / tr.costUsd) * 100 : 0;
    const checks = (arm: "stateweave" | "traditional") => {
      const all = r.turns.filter((t) => t.kind === "check");
      return `${all.filter((t) => t.arms[arm].check?.passed).length}/${all.length}`;
    };
    const missing = sw.missingUsageCalls + tr.missingUsageCalls;
    const rows = r.turns
      .map((t) => {
        const cell = (a: ArmTurn) => `${a.status === "done" ? "" : "⚠ "}${usd(a.usage.costUsd)} · in ${num(a.usage.inputTokens)} · out ${num(a.usage.outputTokens)} · ${(a.ms / 1000).toFixed(1)}s${a.check ? (a.check.passed ? " · ✅" : ` · ❌ ${esc([...a.check.missing.map((m) => `missing "${m}"`), ...a.check.forbidden.map((f) => `stale "${f}"`)].join(", "))}`) : ""}`;
        const detail = (name: string, a: ArmTurn) => `<details><summary>${name} answer</summary><pre>${esc(a.answer ?? a.error ?? "")}</pre></details>`;
        return `<tr><td>${t.turn}</td><td>${t.kind}</td><td>${cell(t.arms.stateweave)}${detail("StateWeave", t.arms.stateweave)}</td><td>${cell(t.arms.traditional)}${detail("Traditional", t.arms.traditional)}</td></tr><tr><td></td><td colspan="3" class="muted">${esc(t.prompt)}</td></tr>`;
      })
      .join("");
    return `
      <h3>Run ${esc(r.id)} — ${esc(r.status)} (${r.turns.length}/${r.turnsPlanned} turns) · ${esc(r.model)}${r.reasoningEffort ? ` · ${esc(r.reasoningEffort)}` : ""}</h3>
      ${r.error ? `<p class="error">${esc(r.error)}</p>` : ""}
      <p><strong>StateWeave ${usd(sw.costUsd)}</strong> vs <strong>Traditional ${usd(tr.costUsd)}</strong>${tr.costUsd > 0 ? ` — StateWeave is ${saving >= 0 ? `${saving.toFixed(1)}% cheaper` : `${(-saving).toFixed(1)}% more expensive`}` : ""}. Recall checks: StateWeave ${checks("stateweave")}, Traditional ${checks("traditional")}.</p>
      ${missing ? `<p class="error">${missing} call(s) returned no usage report; their cost is not counted.</p>` : ""}
      <p class="muted">Equivalent API list price computed from Codex-reported tokens; your subscription is not billed per token. Jev recall calls run on the lab's TypeSafe key and are not included.</p>
      <table class="data-table"><thead><tr><th>Arm</th><th>Calls</th><th>Input</th><th>Cached</th><th>Output</th><th>Reasoning</th><th>Peak input</th><th>Cost</th></tr></thead><tbody>${totalsRow("StateWeave", sw)}${totalsRow("Traditional", tr)}</tbody></table>
      <table class="data-table"><thead><tr><th>#</th><th>Kind</th><th>StateWeave</th><th>Traditional</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function render(): void {
    const s = status;
    const running = run?.status === "running";
    const model = s?.models.find((m) => m.id === form.model);
    let account = "<p>Checking connection…</p>";
    if (s?.busyElsewhere) account = "<p>Another browser holds the Codex connection.</p>";
    else if (s?.connected) account = `<p>✅ Your Codex subscription is connected. <button class="button secondary" data-act="disconnect" ${busy ? "disabled" : ""}>Disconnect</button></p>`;
    else if (s?.pending && s.login) account = `<p>Open <a href="${esc(s.login.verificationUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.login.verificationUrl)}</a> and enter code <strong class="mono">${esc(s.login.userCode)}</strong>. This page updates when you finish.</p><button class="button secondary" data-act="disconnect">Cancel</button>`;
    else account = `${s?.error ? `<p class="error">${esc(s.error)}</p>` : ""}<p>Connect your own ChatGPT subscription through Codex device login. Tokens stay on the server and are deleted when you disconnect.</p><button class="button" data-act="login" ${busy ? "disabled" : ""}>Connect Codex</button>`;

    const controls = s?.connected
      ? `<div class="codex-controls">
          <label>Model <select data-field="model" ${running ? "disabled" : ""}>${s.models.map((m) => `<option value="${esc(m.id)}" ${m.id === form.model ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label>
          <label>Reasoning <select data-field="thinking" ${running ? "disabled" : ""}>${(model?.thinkingLevels.length ? model.thinkingLevels : [""]).map((l) => `<option value="${esc(l)}" ${l === form.thinking ? "selected" : ""}>${esc(l || "default")}</option>`).join("")}</select></label>
          <label>Turns <input data-field="turns" type="number" min="1" max="${s.scriptTurns}" value="${form.turns}" ${running ? "disabled" : ""}></label>
          <label>$/1M input <input data-price="input" type="number" step="0.01" min="0" value="${form.pricing.input}" ${running ? "disabled" : ""}></label>
          <label>$/1M cached <input data-price="cachedInput" type="number" step="0.001" min="0" value="${form.pricing.cachedInput}" ${running ? "disabled" : ""}></label>
          <label>$/1M output <input data-price="output" type="number" step="0.01" min="0" value="${form.pricing.output}" ${running ? "disabled" : ""}></label>
          ${running ? `<button class="button secondary" data-act="stop">Stop</button>` : `<button class="button" data-act="start" ${busy || !form.model ? "disabled" : ""}>Run pilot</button>`}
        </div>
        <p class="muted">Both arms use the same model, reasoning level and system prompt, with no tools. StateWeave: molecular projection (16 nodes / 16K). Traditional: full transcript, compacted at 30K keeping 6 messages. Starting a run spends your subscription quota.</p>`
      : "";

    root.innerHTML = `<section class="protocol-shell codex-cost">
      <h2>Codex cost: StateWeave vs traditional</h2>
      <p>A scripted ${s?.scriptTurns ?? 10}-turn planning chat (Project Halcyon): facts are planted, corrected, buried under long drafting turns, then checked.</p>
      ${account}${controls}
      ${notice ? `<p class="error">${esc(notice)}</p>` : ""}
      ${run ? renderRun(run) : ""}
    </section>`;
  }

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target) return;
    const action = target.dataset.act;
    if (action === "login") void act(async () => void (await call("POST", "/api/codex/login")));
    if (action === "disconnect") void act(async () => void (await call("POST", "/api/codex/disconnect")));
    if (action === "stop") void act(async () => void (await call("POST", "/api/codex-bench/stop")));
    if (action === "start") {
      if (!confirm(`Run ${form.turns} turns × 2 arms on ${form.model}${form.thinking ? ` (${form.thinking})` : ""}? This uses your Codex subscription quota.`)) return;
      void act(async () => void (await call("POST", "/api/codex-bench/start", { model: form.model, thinking: form.thinking, turns: form.turns, pricing: form.pricing })));
    }
  });

  root.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.dataset.field === "model") {
      form.model = input.value;
      const choice = status?.models.find((m) => m.id === form.model);
      form.thinking = choice?.defaultThinking ?? "";
      const price = status?.defaultPricing[form.model];
      if (price) form.pricing = { ...price };
      render();
    } else if (input.dataset.field === "thinking") form.thinking = input.value;
    else if (input.dataset.field === "turns") form.turns = Math.max(1, Math.min(status?.scriptTurns ?? 10, Number(input.value) || 1));
    else if (input.dataset.price) form.pricing = { ...form.pricing, [input.dataset.price]: Number(input.value) || 0 };
  });

  return {
    activate(): void {
      void refresh();
    },
    deactivate(): void {
      window.clearTimeout(timer);
    }
  };
}
