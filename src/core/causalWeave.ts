import { createHash } from "node:crypto";
import { estimateStateWeaveTokens, type StateWeaveTokenEstimate } from "../llm/tokenizer.js";

export type CausalNodeKind = "system" | "goal" | "inference" | "tool_call" | "tool_result" | "resource" | "verification" | "answer" | "protocol_error";

export type CausalWeaveNode = {
  id: string;
  kind: CausalNodeKind;
  parents: string[];
  payload: unknown;
  createdAt: string;
  sequence: number;
  resourceKey?: string;
};

export type CausalWeaveSnapshot = {
  version: 1;
  nodes: CausalWeaveNode[];
  frontier: string[];
};

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

export class CausalWeave {
  private readonly nodes = new Map<string, CausalWeaveNode>();
  private readonly order: string[] = [];
  private readonly frontierIds = new Set<string>();
  private readonly resourceHeads = new Map<string, string>();

  constructor(snapshot?: CausalWeaveSnapshot) {
    if (!snapshot) return;
    if (snapshot.version !== 1) throw new Error(`Unsupported Causal Weave version: ${snapshot.version}`);
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
    const maxTokens = args.maxTokens ?? 64_000;
    const targetTokens = Math.min(args.targetTokens ?? maxTokens, maxTokens);
    const maxNodes = args.maxNodes ?? 48;
    const queryTerms = terms([args.query ?? "", ...this.frontier().map((id) => payloadText(this.nodes.get(id)?.payload))].join(" "));
    const selected = new Set<string>();
    const latestEquivalent = latestProjectionEquivalents(this.order, this.nodes);
    const recent = this.order.slice(-10).filter((id) => {
      const key = projectionEquivalenceKey(this.nodes.get(id)!);
      return !key || latestEquivalent.get(key) === id;
    });
    const mandatory = [
      ...this.order.filter((id) => {
        const kind = this.nodes.get(id)?.kind;
        return kind === "system" || kind === "goal";
      }),
      ...this.frontier(),
      ...this.resourceHeads.values(),
      ...recent
    ];
    for (const id of mandatory) selected.add(id);
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
    let prompt = renderCompiledWeave(chosen.map((id) => this.nodes.get(id)!), this.frontierIds, digest);
    let estimate = estimateStateWeaveTokens(prompt);
    while (estimate.estimatedTokens > targetTokens && chosen.length > 4) {
      const removable = chosen.findIndex((id) => {
        const node = this.nodes.get(id)!;
        return node.kind !== "system" && node.kind !== "goal" && !this.frontierIds.has(id) && !isParentOfSelectedFrontier(id, chosen, this.nodes, this.frontierIds);
      });
      if (removable < 0) break;
      chosen.splice(removable, 1);
      prompt = renderCompiledWeave(chosen.map((id) => this.nodes.get(id)!), this.frontierIds, digest);
      estimate = estimateStateWeaveTokens(prompt);
    }
    if (estimate.estimatedTokens > maxTokens) {
      prompt = truncatePrompt(prompt, maxTokens * 4);
      estimate = estimateStateWeaveTokens(prompt);
    }
    return { prompt, nodeIds: chosen, tokenEstimate: estimate };
  }
}

function causalNodeId(kind: CausalNodeKind, parents: string[], payload: unknown, resourceKey?: string): string {
  const digest = createHash("sha256").update(stableStringify({ kind, parents, payload, resourceKey })).digest("hex");
  return `cw_${digest.slice(0, 24)}`;
}

function renderCompiledWeave(nodes: CausalWeaveNode[], frontier: Set<string>, digest: string): string {
  const lines = [
    "CAUSAL_WEAVE/1",
    "The following is a causally selected working state, not a conversation transcript. Node order is chronological; parents identify direct dependencies. Use the ordinary tool protocol contained in the system node. Current resource and evidence nodes are authoritative.",
    `frontier: ${[...frontier].map(shortId).join(", ") || "(empty)"}`,
    "",
    digest,
    ""
  ];
  for (const node of nodes) {
    const payloadLimit = frontier.has(node.id) || node.kind === "system" || node.kind === "goal" ? 64_000 : node.kind === "tool_result" || node.kind === "resource" ? 12_000 : 6_000;
    lines.push(
      `[${shortId(node.id)} ${node.kind.toUpperCase()}${frontier.has(node.id) ? " HEAD" : ""}]`,
      `parents: ${node.parents.map(shortId).join(", ") || "(root)"}`,
      truncate(payloadText(node.payload), payloadLimit),
      ""
    );
  }
  return lines.join("\n").trim();
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
  if (node.kind === "protocol_error") return `protocol_error:${projectionHash(node.payload)}`;
  if (node.kind === "inference") return `inference:${projectionHash(node.payload)}`;
  if (node.kind === "tool_call") {
    const name = stringValue(payload.name);
    const args = asRecord(payload.args);
    const path = resourcePath(args);
    if (name === "read_file" && path) return `read_call:${path}`;
    if ((name === "write_file" || name === "edit_file") && path) return `mutation_call:${path}`;
    return `tool_call:${name}:${projectionHash(payload.args)}`;
  }
  if (node.kind === "tool_result") {
    const name = stringValue(payload.tool);
    const result = asRecord(payload.result);
    const path = resourcePath(result);
    if (name === "read_file" && path) return `read_result:${path}`;
    if ((name === "write_file" || name === "edit_file") && path) return `mutation_result:${path}`;
    return `tool_result:${name}:${projectionHash(payload.result)}`;
  }
  return undefined;
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
  const authority = node.kind === "resource" || node.kind === "verification" || node.kind === "tool_result" ? 0.25 : node.kind === "goal" ? 0.3 : 0;
  return semantic * 0.55 + recency * 0.2 + authority;
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

function truncatePrompt(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.35);
  const tail = limit - head;
  return `${value.slice(0, head)}\n...[compiled weave truncated to token budget]...\n${value.slice(-tail)}`;
}
