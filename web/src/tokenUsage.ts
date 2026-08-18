import type { TokenCountSource } from "../../src/agent/types.js";

export const maxTokenUsageHistory = 500;
const maxTokenChartPoints = 48;

export type TokenUsageStatus = "running" | "done" | "failed";

export type TokenUsagePoint = {
  turn: number;
  runId: string;
  startedAt: string;
  completedAt?: string;
  latestContextTokens: number;
  peakContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  modelCalls: number;
  maxPromptTokens: number;
  projectionTargetTokens: number;
  tokenCountSource?: TokenCountSource;
  status: TokenUsageStatus;
};

export function parseTokenUsageHistory(value: unknown): TokenUsagePoint[] {
  if (!Array.isArray(value)) return [];
  const points: TokenUsagePoint[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const totalInputTokens = tokenNumber(record.totalInputTokens);
    const outputTokens = tokenNumber(record.outputTokens);
    const modelCalls = tokenNumber(record.modelCalls);
    const latestContextTokens = tokenNumber(record.latestContextTokens);
    if (totalInputTokens === undefined || outputTokens === undefined || modelCalls === undefined || latestContextTokens === undefined) continue;
    const maxPromptTokens = positiveTokenNumber(record.maxPromptTokens) ?? 64_000;
    const requestedProjection = positiveTokenNumber(record.projectionTargetTokens) ?? 16_000;
    const turn = positiveTokenNumber(record.turn) ?? index + 1;
    const status = record.status === "failed" ? "failed" : record.status === "done" ? "done" : undefined;
    if (!status) continue;
    points.push({
      turn,
      runId: boundedString(record.runId) ?? `restored_${turn}`,
      startedAt: boundedString(record.startedAt) ?? new Date(0).toISOString(),
      ...(boundedString(record.completedAt) ? { completedAt: boundedString(record.completedAt) } : {}),
      latestContextTokens,
      peakContextTokens: tokenNumber(record.peakContextTokens) ?? latestContextTokens,
      totalInputTokens,
      outputTokens,
      modelCalls,
      maxPromptTokens,
      projectionTargetTokens: Math.min(requestedProjection, maxPromptTokens),
      ...(isTokenCountSource(record.tokenCountSource) ? { tokenCountSource: record.tokenCountSource } : {}),
      status
    });
  }
  points.sort((left, right) => left.turn - right.turn);
  let priorTurn = 0;
  for (const point of points) {
    point.turn = Math.max(point.turn, priorTurn + 1);
    priorTurn = point.turn;
  }
  return points.slice(-maxTokenUsageHistory);
}

export function renderTokenUsageView(history: TokenUsagePoint[], active?: TokenUsagePoint): { countLabel: string; html: string } {
  const allPoints = active ? [...history, active] : history;
  const countLabel = active
    ? `${history.length.toLocaleString()} turn${history.length === 1 ? "" : "s"} · live`
    : history.length ? `${history.length.toLocaleString()} turn${history.length === 1 ? "" : "s"}` : "No turns";
  if (!allPoints.length) {
    return {
      countLabel,
      html: `<div class="token-usage-empty"><div class="token-empty-lines" aria-hidden="true"><span></span><span></span><span></span></div><h4>No usage recorded yet</h4><p>Send a message to plot provider input, output, and context-window use. History stays in this browser with the chat.</p></div>`
    };
  }

  const latest = allPoints.at(-1)!;
  const peakContext = Math.max(latest.peakContextTokens, latest.latestContextTokens);
  const contextLimit = Math.max(1, latest.maxPromptTokens);
  const contextPercent = clamp((peakContext / contextLimit) * 100, 0, 100);
  const projectionPercent = clamp((latest.projectionTargetTokens / contextLimit) * 100, 0, 100);
  const sessionInput = sum(allPoints, (point) => point.totalInputTokens);
  const sessionOutput = sum(allPoints, (point) => point.outputTokens);
  const sessionCalls = sum(allPoints, (point) => point.modelCalls);
  const latestLabel = latest.status === "running" ? `Turn ${latest.turn} · running` : `Turn ${latest.turn} · ${latest.status}`;

  return {
    countLabel,
    html: `
      <section class="token-latest" aria-label="Latest token usage">
        <div class="token-latest-heading">
          <div><span>${escapeHtml(latestLabel)}</span><strong>${escapeHtml(sourceLabel(latest))}</strong></div>
          <small>${latest.status === "running" && latest.modelCalls === 0 ? "Waiting for the first model response" : `${latest.modelCalls.toLocaleString()} model call${latest.modelCalls === 1 ? "" : "s"}`}</small>
        </div>
        <div class="token-metrics">
          ${metricHtml("Peak context", formatTokens(peakContext), `of ${formatAxisTokens(contextLimit)} prompt ceiling`)}
          ${metricHtml("Turn input", formatTokens(latest.totalInputTokens), latest.modelCalls > 1 ? `sum across ${latest.modelCalls} calls` : "sent to the model")}
          ${metricHtml("Turn output", formatTokens(latest.outputTokens), "received from the model")}
          ${metricHtml("Session total", formatTokens(sessionInput + sessionOutput), `${formatAxisTokens(sessionInput)} in · ${formatAxisTokens(sessionOutput)} out`)}
        </div>
        <div class="token-context-meter" role="meter" aria-label="Peak context-window use" aria-valuemin="0" aria-valuemax="${contextLimit}" aria-valuenow="${peakContext}">
          <span style="width:${contextPercent.toFixed(3)}%"></span>
          <i style="left:${projectionPercent.toFixed(3)}%" title="Working projection target: ${formatTokens(latest.projectionTargetTokens)}"></i>
        </div>
        <div class="token-context-labels"><span>${contextPercent.toFixed(contextPercent >= 10 ? 0 : 1)}% of prompt ceiling</span><span>${formatTokens(latest.projectionTargetTokens)} working target · ${formatTokens(contextLimit)} hard ceiling</span></div>
      </section>
      ${usageChartHtml(allPoints)}
      <div class="token-session-foot"><span><strong>${sessionCalls.toLocaleString()}</strong> model calls this session</span><span>Failed runs are retained when usage was measurable.</span></div>
      ${usageLedgerHtml(allPoints)}
    `
  };
}

function usageChartHtml(points: TokenUsagePoint[]): string {
  const measured = points.filter((point) => point.modelCalls > 0 || point.totalInputTokens > 0 || point.outputTokens > 0);
  if (!measured.length) {
    return `<section class="token-chart-section token-chart-waiting"><h4>Usage by turn</h4><p>The chart will draw after the first model response.</p></section>`;
  }
  const visible = measured.slice(-maxTokenChartPoints);
  const width = 880;
  const height = 320;
  const plot = { left: 66, right: 22, top: 24, bottom: 46 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const maximum = niceTokenCeiling(Math.max(...visible.flatMap((point) => [point.totalInputTokens, point.outputTokens, point.peakContextTokens]), 1));
  const x = (index: number): number => visible.length === 1 ? plot.left + plotWidth / 2 : plot.left + (index / (visible.length - 1)) * plotWidth;
  const y = (value: number): number => plot.top + plotHeight - (value / maximum) * plotHeight;
  const tickCount = 5;
  const yGrid = Array.from({ length: tickCount }, (_, index) => {
    const value = maximum - (maximum * index) / (tickCount - 1);
    const position = plot.top + (plotHeight * index) / (tickCount - 1);
    return `<g class="token-chart-grid"><line x1="${plot.left}" y1="${position.toFixed(2)}" x2="${width - plot.right}" y2="${position.toFixed(2)}"></line><text x="${plot.left - 10}" y="${(position + 4).toFixed(2)}">${escapeHtml(formatAxisTokens(value))}</text></g>`;
  }).join("");
  const labelEvery = Math.max(1, Math.ceil(visible.length / 8));
  const xLabels = visible.map((point, index) => {
    if (index !== 0 && index !== visible.length - 1 && index % labelEvery !== 0) return "";
    return `<text class="token-chart-x-label" x="${x(index).toFixed(2)}" y="${height - 16}" text-anchor="middle">T${point.turn}</text>`;
  }).join("");
  const series = [
    { key: "peakContextTokens" as const, css: "context", label: "Peak context" },
    { key: "totalInputTokens" as const, css: "input", label: "Turn input" },
    { key: "outputTokens" as const, css: "output", label: "Turn output" }
  ];
  const paths = series.map((item) => {
    const path = visible.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(point[item.key]).toFixed(2)}`).join(" ");
    const dots = visible.map((point, index) => `<circle class="token-chart-dot ${item.css} ${point.status}" cx="${x(index).toFixed(2)}" cy="${y(point[item.key]).toFixed(2)}" r="4" tabindex="0"><title>Turn ${point.turn} · ${item.label}: ${point[item.key].toLocaleString()} tokens${point.status === "failed" ? " · failed run" : point.status === "running" ? " · running" : ""}</title></circle>`).join("");
    return `<path class="token-chart-line ${item.css}" d="${path}"></path>${dots}`;
  }).join("");
  const range = visible.length < measured.length ? `Last ${visible.length} of ${measured.length} measured turns` : `${visible.length} measured turn${visible.length === 1 ? "" : "s"}`;
  const chartSummary = visible.map((point) => `turn ${point.turn}: ${point.totalInputTokens} input, ${point.outputTokens} output, ${point.peakContextTokens} peak context`).join("; ");

  return `
    <section class="token-chart-section">
      <header><div><h4>Usage by turn</h4><p>${escapeHtml(range)}</p></div><div class="token-chart-legend" aria-label="Chart legend"><span class="input">Input</span><span class="output">Output</span><span class="context">Peak context</span></div></header>
      <div class="token-chart-frame">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="token-chart-title token-chart-description">
          <title id="token-chart-title">LLM token usage by chat turn</title>
          <desc id="token-chart-description">${escapeHtml(chartSummary)}</desc>
          ${yGrid}
          ${xLabels}
          ${paths}
        </svg>
      </div>
      <p class="token-chart-note">Input is the sum of every model call in a turn. Peak context is the largest single call, so multi-step tool runs can have higher total input than context use.</p>
    </section>`;
}

function usageLedgerHtml(points: TokenUsagePoint[]): string {
  const shown = [...points].reverse().slice(0, 100);
  const rows = shown.map((point) => `
    <tr>
      <th scope="row"><span>T${point.turn}</span><small title="${escapeAttribute(point.runId)}">${escapeHtml(point.status)}</small></th>
      <td>${point.peakContextTokens.toLocaleString()}</td>
      <td>${point.totalInputTokens.toLocaleString()}</td>
      <td>${point.outputTokens.toLocaleString()}</td>
      <td>${point.modelCalls.toLocaleString()}</td>
      <td><span class="token-source ${point.tokenCountSource ?? "pending"}">${escapeHtml(shortSourceLabel(point.tokenCountSource))}</span></td>
    </tr>`).join("");
  const note = points.length > shown.length ? ` · latest ${shown.length} shown` : "";
  return `<details class="token-ledger"><summary>Turn ledger · ${points.length.toLocaleString()} record${points.length === 1 ? "" : "s"}${note}</summary><div class="token-ledger-scroll"><table><thead><tr><th>Turn</th><th>Peak context</th><th>Input</th><th>Output</th><th>Calls</th><th>Count source</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function metricHtml(label: string, value: string, detail: string): string {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function sourceLabel(point: TokenUsagePoint): string {
  if (point.status === "running" && !point.tokenCountSource) return "Measuring";
  if (point.tokenCountSource === "provider") return "Provider measured";
  if (point.tokenCountSource === "mixed") return "Provider + estimated";
  if (point.tokenCountSource === "estimated") return "SDK tokenizer estimate";
  return "Count source pending";
}

function shortSourceLabel(source: TokenCountSource | undefined): string {
  if (source === "provider") return "Provider";
  if (source === "mixed") return "Mixed";
  if (source === "estimated") return "Estimated";
  return "Pending";
}

function sum(points: TokenUsagePoint[], read: (point: TokenUsagePoint) => number): number {
  return points.reduce((total, point) => total + read(point), 0);
}

function niceTokenCeiling(value: number): number {
  const safe = Math.max(100, value);
  const exponent = 10 ** Math.floor(Math.log10(safe));
  const normalized = safe / exponent;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * exponent;
}

function formatTokens(value: number): string {
  return `${Math.round(value).toLocaleString()} tok`;
}

function formatAxisTokens(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return Math.round(value).toString();
}

function trimDecimal(value: number): string {
  return value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function tokenNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000_000 ? Math.round(value) : undefined;
}

function positiveTokenNumber(value: unknown): number | undefined {
  const parsed = tokenNumber(value);
  return parsed && parsed > 0 ? parsed : undefined;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined;
}

function isTokenCountSource(value: unknown): value is TokenCountSource {
  return value === "provider" || value === "estimated" || value === "mixed";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
