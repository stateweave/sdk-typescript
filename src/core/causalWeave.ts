import { createHash } from "node:crypto";
import { estimateStateWeaveTokens, type StateWeaveTokenEstimate } from "../llm/tokenizer.js";
import { projectCausalSnapshot, type CausalProjection } from "./causalProjection.js";
import type { CausalNodeKind, CausalWeaveNode, CausalWeaveSnapshot } from "./causalTypes.js";

export type { CausalNodeKind, CausalWeaveNode, CausalWeaveSnapshot } from "./causalTypes.js";

export type CausalCompileResult = {
  prompt: string;
  nodeIds: string[];
  tokenEstimate: StateWeaveTokenEstimate;
};

export type CausalAppend = {
  kind: CausalNodeKind;
  payload: unknown;
  parents?: string[];
  resourceKey?: string;
  advance?: boolean;
};

export class CausalPromptBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CausalPromptBudgetExceededError";
  }
}

export class CausalWeave {
  private readonly nodes = new Map<string, CausalWeaveNode>();
  private readonly order: string[] = [];
  private readonly frontierIds = new Set<string>();
  private readonly resourceHeads = new Map<string, string>();

  constructor(snapshot?: CausalWeaveSnapshot) {
    if (!snapshot) return;
    assertValidCausalWeaveSnapshot(snapshot);
    for (const node of snapshot.nodes) {
      this.nodes.set(node.id, structuredClone(node));
      this.order.push(node.id);
      if (node.resourceKey) this.resourceHeads.set(node.resourceKey, node.id);
    }
    for (const id of snapshot.frontier) {
      if (!this.nodes.has(id)) throw new Error(`Causal Weave frontier references missing node: ${id}`);
      this.frontierIds.add(id);
    }
  }

  append(input: CausalAppend): CausalWeaveNode {
    const parents = unique(input.parents ?? [...this.frontierIds]);
    for (const id of parents) if (!this.nodes.has(id)) throw new Error(`Causal Weave parent does not exist: ${id}`);
    const previousResource = input.resourceKey ? this.resourceHeads.get(input.resourceKey) : undefined;
    if (previousResource && !parents.includes(previousResource)) parents.push(previousResource);
    parents.sort();
    const id = causalNodeId(input.kind, parents, input.payload, input.resourceKey);
    let node = this.nodes.get(id);
    if (!node) {
      node = {
        id,
        kind: input.kind,
        parents,
        payload: structuredClone(input.payload),
        createdAt: new Date().toISOString(),
        sequence: this.order.length + 1,
        ...(input.resourceKey ? { resourceKey: input.resourceKey } : {})
      };
      this.nodes.set(id, node);
      this.order.push(id);
    }
    if (input.advance !== false) {
      for (const parent of parents) this.frontierIds.delete(parent);
      if (previousResource) this.frontierIds.delete(previousResource);
      this.frontierIds.add(id);
    }
    if (input.resourceKey) this.resourceHeads.set(input.resourceKey, id);
    return structuredClone(node);
  }

  get(id: string): CausalWeaveNode | undefined {
    const node = this.nodes.get(id);
    return node ? structuredClone(node) : undefined;
  }

  frontier(): string[] {
    return [...this.frontierIds];
  }

  snapshot(): CausalWeaveSnapshot {
    return {
      version: 1,
      nodes: this.order.map((id) => structuredClone(this.nodes.get(id)!)),
      frontier: [...this.frontierIds]
    };
  }

  compile(args: { query?: string; maxTokens?: number; targetTokens?: number; maxNodes?: number } = {}): CausalCompileResult {
    if (!this.order.length) throw new Error("Cannot compile an empty Causal Weave.");
    const maxTokens = boundedCompileBudget(args.maxTokens ?? 64_000, "maxTokens");
    const targetTokens = boundedCompileBudget(Math.min(args.targetTokens ?? maxTokens, maxTokens), "targetTokens");
    const maxNodes = boundedPositiveInteger(args.maxNodes ?? 48, "maxNodes");
    const snapshot = this.snapshot();
    const overview = projectCausalSnapshot(snapshot);
    const queryTerms = terms([args.query ?? "", ...this.frontier().map((id) => payloadText(this.nodes.get(id)?.payload))].join(" "));
    const selected = new Set<string>();
    const latestEquivalent = latestProjectionEquivalents(this.order, this.nodes);
    const recent = this.order.slice(-10).filter((id) => {
      const key = projectionEquivalenceKey(this.nodes.get(id)!);
      return !key || latestEquivalent.get(key) === id;
    });
    const reverseOrder = [...this.order].reverse();
    const latestSystem = reverseOrder.find((id) => this.nodes.get(id)?.kind === "system");
    const latestGoal = reverseOrder.find((id) => this.nodes.get(id)?.kind === "goal");
    const mandatory = [
      ...(latestSystem ? [latestSystem] : []),
      ...(latestGoal ? [latestGoal] : []),
      ...this.frontier(),
      ...this.resourceHeads.values(),
      ...recent
    ];
    for (const id of mandatory) selected.add(id);
    for (const id of overview.focusNodeIds.slice(0, maxNodes)) {
      const node = this.nodes.get(id);
      if (node && (node.kind !== "goal" || id === latestGoal)) selected.add(id);
    }
    const closureSeeds = new Set([...this.frontier(), ...recent]);
    addOperationalParents(closureSeeds, this.nodes, 2);
    for (const id of closureSeeds) selected.add(id);

    const candidates = this.order
      .filter((id) => !selected.has(id))
      .filter((id) => {
        const key = projectionEquivalenceKey(this.nodes.get(id)!);
        return !key || latestEquivalent.get(key) === id;
      })
      .map((id) => ({ id, score: relevanceScore(this.nodes.get(id)!, queryTerms, this.order.length) }))
      .sort((a, b) => b.score - a.score || this.nodes.get(b.id)!.sequence - this.nodes.get(a.id)!.sequence);
    for (const candidate of candidates) {
      if (selected.size >= maxNodes) break;
      const closure = new Set([candidate.id]);
      addOperationalParents(closure, this.nodes, 2);
      for (const id of closure) selected.add(id);
    }

    let chosen = this.order.filter((id) => selected.has(id));
    const digest = renderGraphDigest(this.order.map((id) => this.nodes.get(id)!), this.resourceHeads);
    const render = (payloadLimit?: number): { prompt: string; estimate: StateWeaveTokenEstimate } => {
      const prompt = renderCompiledWeave(chosen.map((id) => this.nodes.get(id)!), this.frontierIds, digest, overview, payloadLimit);
      return { prompt, estimate: estimateStateWeaveTokens(prompt) };
    };
    let rendered = render();
    while (rendered.estimate.estimatedTokens > targetTokens && chosen.length > 4) {
      const removable = removableProjectionNode(chosen, this.nodes, this.frontierIds, latestGoal);
      if (removable < 0) break;
      chosen.splice(removable, 1);
      rendered = render();
    }

    if (rendered.estimate.estimatedTokens > targetTokens) {
      for (const payloadLimit of [12_000, 6_000, 3_000, 1_500, 800, 400]) {
        rendered = render(payloadLimit);
        if (rendered.estimate.estimatedTokens <= targetTokens) break;
      }
      while (rendered.estimate.estimatedTokens > targetTokens && chosen.length > 4) {
        const removable = removableProjectionNode(chosen, this.nodes, this.frontierIds, latestGoal);
        if (removable < 0) break;
        chosen.splice(removable, 1);
        rendered = render(400);
      }
    }

    if (rendered.estimate.estimatedTokens > maxTokens) {
      for (const payloadLimit of [12_000, 6_000, 3_000, 1_500, 800, 400]) {
        rendered = render(payloadLimit);
        if (rendered.estimate.estimatedTokens <= maxTokens) break;
      }
      while (rendered.estimate.estimatedTokens > maxTokens && chosen.length > 4) {
        const removable = removableProjectionNode(chosen, this.nodes, this.frontierIds, latestGoal);
        if (removable < 0) break;
        chosen.splice(removable, 1);
        rendered = render(400);
      }
    }

    if (rendered.estimate.estimatedTokens > maxTokens) {
      throw new CausalPromptBudgetExceededError(`Mandatory Causal Weave state cannot fit within the ${maxTokens}-token prompt budget.`);
    }
    return { prompt: rendered.prompt, nodeIds: chosen, tokenEstimate: rendered.estimate };
  }
}

export function assertValidCausalWeaveSnapshot(snapshot: CausalWeaveSnapshot): void {
  if (snapshot.version !== 1) throw new Error(`Unsupported Causal Weave version: ${snapshot.version}`);
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.frontier)) throw new Error("Causal Weave state requires nodes and frontier arrays.");
  const ids = new Set<string>();
  const kinds = new Set<CausalNodeKind>(["system", "goal", "inference", "semantic", "tool_call", "tool_result", "resource", "verification", "answer", "protocol_error"]);
  for (const [index, node] of snapshot.nodes.entries()) {
    if (!node || typeof node !== "object" || typeof node.id !== "string" || !Array.isArray(node.parents) || !kinds.has(node.kind)) throw new Error(`Invalid Causal Weave node at index ${index}.`);
    if (typeof node.createdAt !== "string" || Number.isNaN(Date.parse(node.createdAt))) throw new Error(`Invalid Causal Weave node timestamp: ${node.id}`);
    if (!Number.isInteger(node.sequence) || node.sequence !== index + 1) throw new Error(`Causal Weave node sequence mismatch: ${node.id}`);
    if (node.resourceKey !== undefined && typeof node.resourceKey !== "string") throw new Error(`Invalid Causal Weave resource key: ${node.id}`);
    if (node.parents.some((parent) => typeof parent !== "string")) throw new Error(`Invalid Causal Weave parent list: ${node.id}`);
    if (new Set(node.parents).size !== node.parents.length) throw new Error(`Duplicate Causal Weave parent: ${node.id}`);
    if (node.parents.some((parent, parentIndex) => parentIndex > 0 && node.parents[parentIndex - 1]! > parent)) throw new Error(`Causal Weave parents are not sorted: ${node.id}`);
    if (ids.has(node.id)) throw new Error(`Duplicate Causal Weave node: ${node.id}`);
    for (const parent of node.parents) if (!ids.has(parent)) throw new Error(`Causal Weave node ${node.id} references a missing or non-causal parent: ${parent}`);
    const expected = causalNodeId(node.kind, node.parents, node.payload, node.resourceKey);
    if (node.id !== expected) throw new Error(`Causal Weave node identity mismatch: ${node.id}`);
    ids.add(node.id);
  }
  const frontierIds = new Set<string>();
  for (const id of snapshot.frontier) {
    if (frontierIds.has(id)) throw new Error(`Duplicate Causal Weave frontier node: ${id}`);
    if (!ids.has(id)) throw new Error(`Causal Weave frontier references missing node: ${id}`);
    frontierIds.add(id);
  }
}

function causalNodeId(kind: CausalNodeKind, parents: string[], payload: unknown, resourceKey?: string): string {
  const digest = createHash("sha256").update(stableStringify({ kind, parents, payload, resourceKey })).digest("hex");
  return `cw_${digest.slice(0, 24)}`;
}

function renderCompiledWeave(
  nodes: CausalWeaveNode[],
  frontier: Set<string>,
  digest: string,
  overview: CausalProjection,
  payloadLimit?: number
): string {
  const compact = payloadLimit !== undefined;
  const lines = [
    "CAUSAL_WEAVE/1",
    "The following is a causally selected working state, not a conversation transcript. Node order is chronological; parents identify direct dependencies. Use the ordinary tool protocol contained in the system node. Current resource and evidence nodes are authoritative.",
    `frontier: ${[...frontier].map(shortId).join(", ") || "(empty)"}`,
    "",
    truncate(digest, compact ? Math.min(payloadLimit, 3_500) : 12_000),
    "",
    "<BIG_BRAIN>",
    ...clusterLines(overview.bigBrainClusters, compact ? 4 : 48, overview.focusClusterIds),
    "</BIG_BRAIN>",
    ""
  ];

  if (overview.peripheralClusters.length) {
    lines.push("<PERIPHERAL>", ...clusterLines(overview.peripheralClusters, compact ? 4 : 24, overview.focusClusterIds), "</PERIPHERAL>", "");
  }

  lines.push("<FOCUS>");
  const visible = new Set(nodes.map((node) => node.id));
  const focusIds = overview.focusNodeIds.filter((id) => visible.has(id));
  const focusNodes = focusIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is CausalWeaveNode => Boolean(node));
  const orderedNodes = uniqueNodes([...focusNodes, ...nodes]);
  for (const node of orderedNodes) {
    const nodeLimit = payloadLimit ?? (frontier.has(node.id) || node.kind === "system" || node.kind === "goal" ? 64_000 : node.kind === "tool_result" || node.kind === "resource" ? 12_000 : 6_000);
    lines.push(
      `node ${shortId(node.id)} [${node.kind}]${frontier.has(node.id) ? " HEAD" : ""}`,
      `parents: ${node.parents.map(shortId).join(", ") || "(root)"}`,
      truncate(payloadText(node.payload), nodeLimit),
      ""
    );
  }
  if (!orderedNodes.length) lines.push("(empty focus)");
  lines.push("</FOCUS>");

  const timeline = overview.timelineNodeIds.filter((id) => visible.has(id));
  if (timeline.length) {
    lines.push("", "<TIMELINE>", "recent non-structural nodes in causal sequence (lower sequence means earlier)");
    for (const id of timeline) {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) lines.push(`- seq=${node.sequence} ${shortId(node.id)} [${node.kind}] ${inline(payloadText(node.payload), compact ? 120 : 240)}`);
    }
    lines.push("</TIMELINE>");
  }

  return lines.join("\n").trim();
}

function clusterLines(clusters: CausalProjection["bigBrainClusters"], limit: number, focusClusterIds: string[]): string[] {
  if (!clusters.length) return ["(no topics yet)"];
  const focus = new Set(focusClusterIds);
  const shown = clusters.slice(0, limit);
  const lines = shown.map((cluster) => {
    const isFocused = focus.has(cluster.id);
    const summary = isFocused ? cluster.summary : `${cluster.nodeCount}n ${cluster.edgeCount}e · ${cluster.dominantType}`;
    const label = isFocused ? ` "${truncate(cluster.label, 80)}"` : " topic cluster";
    return `- ${cluster.id}${isFocused ? " *" : ""} (${summary})${label}`;
  });
  if (clusters.length > shown.length) lines.push(`- ... +${clusters.length - shown.length} topic clusters omitted; use the current focus and query to retrieve them`);
  return lines;
}

function uniqueNodes(nodes: CausalWeaveNode[]): CausalWeaveNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function latestProjectionEquivalents(order: string[], nodes: Map<string, CausalWeaveNode>): Map<string, string> {
  const latest = new Map<string, string>();
  for (const id of order) {
    const key = projectionEquivalenceKey(nodes.get(id)!);
    if (key) latest.set(key, id);
  }
  return latest;
}

function projectionEquivalenceKey(node: CausalWeaveNode): string | undefined {
  const payload = asRecord(node.payload);
  if (node.kind === "resource" && node.resourceKey) return `resource:${node.resourceKey}`;
  if (node.kind === "semantic" && node.resourceKey) return node.resourceKey;
  if (node.kind === "protocol_error") return `protocol_error:${projectionHash(node.payload)}`;
  if (node.kind === "inference") return `inference:${projectionHash(node.payload)}`;
  if (node.kind === "tool_call") {
    const name = stringValue(payload.name);
    const args = asRecord(payload.args);
    const path = resourcePath(args);
    if (name === "read_file" && path) return `read_call:${path}:${readRangeKey(args)}`;
    if ((name === "write_file" || name === "edit_file") && path) return `mutation_call:${path}`;
    return `tool_call:${name}:${projectionHash(payload.args)}`;
  }
  if (node.kind === "tool_result") {
    const name = stringValue(payload.tool);
    const result = asRecord(payload.result);
    const path = resourcePath(result);
    if (name === "read_file" && path) return `read_result:${path}:${readRangeKey(result)}`;
    if ((name === "write_file" || name === "edit_file") && path) return `mutation_result:${path}`;
    return `tool_result:${name}:${projectionHash(payload.result)}`;
  }
  return undefined;
}

// Reads are equivalence-collapsed by file PATH by default, which evicts earlier
// chunks when a file is read in ranges (offset/limit). Keying on the read range
// too means chunked reads of one file coexist in the projection instead of
// ping-ponging (the model re-reading offset 0, then 100, then 0, ...). Two reads
// of the same range still collapse to the latest (a larger re-read supersedes a
// smaller one at the same offset).
function readRangeKey(record: Record<string, unknown>): string {
  const offset = Number(record.offset ?? 0);
  if (!Number.isFinite(offset) || offset <= 0) return "o0";
  return `o${Math.floor(offset)}`;
}

function renderGraphDigest(nodes: CausalWeaveNode[], resourceHeads: Map<string, string>): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const kindCounts = new Map<CausalNodeKind, number>();
  const toolCounts = new Map<string, number>();
  const resourceActivity = new Map<string, { total: number; reads: number; mutations: number; failures: number; last: number }>();
  const mutations: CausalWeaveNode[] = [];
  const modelNotes: { sequence: number; note: string }[] = [];

  for (const node of nodes) {
    kindCounts.set(node.kind, (kindCounts.get(node.kind) ?? 0) + 1);
    if (node.kind === "tool_call") {
      const name = stringValue(asRecord(node.payload).name) || "unknown";
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
    }
    if (node.kind === "resource" && node.resourceKey) {
      const payload = asRecord(node.payload);
      const operation = stringValue(payload.operation);
      const activity = resourceActivity.get(node.resourceKey) ?? { total: 0, reads: 0, mutations: 0, failures: 0, last: 0 };
      activity.total += 1;
      activity.reads += operation === "read_file" ? 1 : 0;
      activity.mutations += operation !== "read_file" && payload.succeeded !== false ? 1 : 0;
      activity.failures += payload.succeeded === false ? 1 : 0;
      activity.last = node.sequence;
      resourceActivity.set(node.resourceKey, activity);
      if (operation !== "read_file" && payload.succeeded !== false) mutations.push(node);
    }
    if (node.kind === "inference") {
      const note = inferenceNote(node.payload);
      if (note) modelNotes.push({ sequence: node.sequence, note });
    }
  }

  const lines = [
    "GRAPH_DIGEST",
    "Deterministic whole-graph index. Counts and resource state are runtime-derived; recent model notes are quoted from recorded inference nodes.",
    `nodes: ${nodes.length}; kinds: ${[...kindCounts.entries()].map(([kind, count]) => `${kind}=${count}`).join(", ")}`,
    `tool_calls: ${[...toolCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tool, count]) => `${tool}=${count}`).join(", ") || "(none)"}`,
    "current_resources:"
  ];

  const currentResources = [...resourceHeads.entries()]
    .map(([key, id]) => ({ key, node: byId.get(id)! }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (!currentResources.length) lines.push("- (none)");
  for (const { key, node } of currentResources.slice(0, 100)) {
    const payload = asRecord(node.payload);
    const hash = stringValue(payload.contentHash);
    lines.push(`- ${inline(key, 180)} | seq=${node.sequence} op=${stringValue(payload.operation) || "unknown"} ok=${payload.succeeded !== false}${typeof payload.bytes === "number" ? ` bytes=${payload.bytes}` : ""}${hash ? ` hash=${hash.slice(0, 12)}` : ""}`);
  }
  if (currentResources.length > 100) lines.push(`- ...${currentResources.length - 100} more resources omitted`);

  const repeated = [...resourceActivity.entries()]
    .filter(([, activity]) => activity.total > 1)
    .sort((a, b) => b[1].total - a[1].total || b[1].last - a[1].last)
    .slice(0, 20);
  lines.push("highest_resource_activity:");
  if (!repeated.length) lines.push("- (none)");
  for (const [key, activity] of repeated) {
    lines.push(`- ${inline(key, 160)} | total=${activity.total} reads=${activity.reads} mutations=${activity.mutations} failures=${activity.failures} last_seq=${activity.last}`);
  }

  lines.push("recent_mutations:");
  const recentMutations = mutations.slice(-12);
  if (!recentMutations.length) lines.push("- (none)");
  for (const node of recentMutations) {
    const payload = asRecord(node.payload);
    lines.push(`- seq=${node.sequence} ${stringValue(payload.operation) || "mutation"} ${inline(node.resourceKey ?? stringValue(payload.path), 180)}`);
  }

  lines.push("recent_model_notes:");
  const recentNotes = modelNotes.slice(-3);
  if (!recentNotes.length) lines.push("- (none)");
  for (const note of recentNotes) lines.push(`- seq=${note.sequence} ${inline(note.note, 1_200)}`);
  lines.push("END_GRAPH_DIGEST");
  return truncate(lines.join("\n"), 12_000);
}

function inferenceNote(payload: unknown): string {
  if (typeof payload !== "string") return "";
  const marker = payload.search(/\bTOOL_CALL\b|\bFINAL\s*:/i);
  const note = (marker > 0 ? payload.slice(0, marker) : marker === 0 ? "" : payload).trim();
  return note.length >= 20 && /\s/.test(note) ? note : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resourcePath(record: Record<string, unknown>): string {
  return stringValue(record.file_path) || stringValue(record.path);
}

function projectionHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function inline(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 16))}...[truncated]`;
}

function relevanceScore(node: CausalWeaveNode, queryTerms: Set<string>, total: number): number {
  const nodeTerms = terms(payloadText(node.payload));
  let overlap = 0;
  for (const term of queryTerms) if (nodeTerms.has(term)) overlap += 1;
  const semantic = queryTerms.size ? overlap / Math.sqrt(queryTerms.size * Math.max(1, nodeTerms.size)) : 0;
  const recency = node.sequence / Math.max(1, total);
  const semanticType = node.kind === "semantic" ? stringValue(asRecord(node.payload).type).toLowerCase() : "";
  const typeMatch = semanticType && (queryTerms.has(semanticType) || queryTerms.has(`${semanticType}s`)) ? 0.35 : 0;
  const authority = node.kind === "resource" || node.kind === "verification" || node.kind === "tool_result" ? 0.25 : node.kind === "goal" ? 0.3 : node.kind === "semantic" ? 0.15 : 0;
  return semantic * 0.55 + recency * 0.2 + authority + typeMatch;
}

function addOperationalParents(selected: Set<string>, nodes: Map<string, CausalWeaveNode>, depth: number): void {
  const queue = [...selected].map((id) => ({ id, remaining: depth }));
  while (queue.length) {
    const current = queue.shift()!;
    if (current.remaining <= 0) continue;
    const node = nodes.get(current.id);
    if (!node || !followsOperationalParents(node.kind)) continue;
    for (const parent of node.parents) {
      if (!isOperationalParent(node, nodes.get(parent))) continue;
      if (!selected.has(parent)) selected.add(parent);
      queue.push({ id: parent, remaining: current.remaining - 1 });
    }
  }
}

function followsOperationalParents(kind: CausalNodeKind): boolean {
  return kind === "tool_result" || kind === "resource" || kind === "verification" || kind === "protocol_error";
}

function isOperationalParent(node: CausalWeaveNode, parent: CausalWeaveNode | undefined): boolean {
  return !(node.kind === "resource" && parent?.kind === "resource");
}

function isParentOfSelectedFrontier(id: string, selected: string[], nodes: Map<string, CausalWeaveNode>, frontier: Set<string>): boolean {
  const selectedSet = new Set(selected);
  const queue = [...frontier];
  const seen = new Set<string>();
  let depth = 0;
  while (queue.length && depth < 3) {
    const width = queue.length;
    for (let index = 0; index < width; index++) {
      const current = queue.shift()!;
      if (seen.has(current) || !selectedSet.has(current)) continue;
      seen.add(current);
      const node = nodes.get(current);
      if (!node || !followsOperationalParents(node.kind)) continue;
      for (const parent of node.parents) {
        if (!isOperationalParent(node, nodes.get(parent))) continue;
        if (parent === id) return true;
        queue.push(parent);
      }
    }
    depth += 1;
  }
  return false;
}

function payloadText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return stableStringify(payload);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function terms(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []).slice(0, 20_000));
}

function shortId(id: string): string {
  return id.slice(0, 11);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n...[${value.length - limit} characters omitted]`;
}

function removableProjectionNode(chosen: string[], nodes: Map<string, CausalWeaveNode>, frontier: Set<string>, latestGoal: string | undefined): number {
  return chosen.findIndex((id) => {
    const node = nodes.get(id)!;
    return node.kind !== "system" && id !== latestGoal && !frontier.has(id) && !isParentOfSelectedFrontier(id, chosen, nodes, frontier);
  });
}

function boundedCompileBudget(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 256) throw new Error(`${name} must be an integer of at least 256; received ${String(value)}.`);
  return value;
}

function boundedPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer; received ${String(value)}.`);
  return value;
}
