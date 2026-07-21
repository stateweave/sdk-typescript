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

  compile(args: { query?: string; maxTokens?: number; maxNodes?: number } = {}): CausalCompileResult {
    if (!this.order.length) throw new Error("Cannot compile an empty Causal Weave.");
    const maxTokens = args.maxTokens ?? 64_000;
    const maxNodes = args.maxNodes ?? 48;
    const queryTerms = terms([args.query ?? "", ...this.frontier().map((id) => payloadText(this.nodes.get(id)?.payload))].join(" "));
    const selected = new Set<string>();
    const mandatory = [
      ...this.order.filter((id) => {
        const kind = this.nodes.get(id)?.kind;
        return kind === "system" || kind === "goal";
      }),
      ...this.frontier(),
      ...this.resourceHeads.values(),
      ...this.order.slice(-10)
    ];
    for (const id of mandatory) selected.add(id);
    const closureSeeds = new Set([...this.frontier(), ...this.order.slice(-10)]);
    addCausalParents(closureSeeds, this.nodes, 2);
    for (const id of closureSeeds) selected.add(id);

    const candidates = this.order
      .filter((id) => !selected.has(id))
      .map((id) => ({ id, score: relevanceScore(this.nodes.get(id)!, queryTerms, this.order.length) }))
      .sort((a, b) => b.score - a.score || this.nodes.get(b.id)!.sequence - this.nodes.get(a.id)!.sequence);
    for (const candidate of candidates) {
      if (selected.size >= maxNodes) break;
      const closure = new Set([candidate.id]);
      addCausalParents(closure, this.nodes, 1);
      for (const id of closure) selected.add(id);
    }

    let chosen = this.order.filter((id) => selected.has(id));
    let prompt = renderCompiledWeave(chosen.map((id) => this.nodes.get(id)!), this.frontierIds);
    let estimate = estimateStateWeaveTokens(prompt);
    while (estimate.estimatedTokens > maxTokens && chosen.length > 4) {
      const removable = chosen.findIndex((id) => {
        const node = this.nodes.get(id)!;
        return node.kind !== "system" && node.kind !== "goal" && !this.frontierIds.has(id) && !isParentOfSelectedFrontier(id, chosen, this.nodes, this.frontierIds);
      });
      if (removable < 0) break;
      chosen.splice(removable, 1);
      prompt = renderCompiledWeave(chosen.map((id) => this.nodes.get(id)!), this.frontierIds);
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

function renderCompiledWeave(nodes: CausalWeaveNode[], frontier: Set<string>): string {
  const lines = [
    "CAUSAL_WEAVE/1",
    "The following is a causally selected working state, not a conversation transcript. Node order is chronological; parents identify direct dependencies. Use the ordinary tool protocol contained in the system node. Current resource and evidence nodes are authoritative.",
    `frontier: ${[...frontier].map(shortId).join(", ") || "(empty)"}`,
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

function relevanceScore(node: CausalWeaveNode, queryTerms: Set<string>, total: number): number {
  const nodeTerms = terms(payloadText(node.payload));
  let overlap = 0;
  for (const term of queryTerms) if (nodeTerms.has(term)) overlap += 1;
  const semantic = queryTerms.size ? overlap / Math.sqrt(queryTerms.size * Math.max(1, nodeTerms.size)) : 0;
  const recency = node.sequence / Math.max(1, total);
  const authority = node.kind === "resource" || node.kind === "verification" || node.kind === "tool_result" ? 0.25 : node.kind === "goal" ? 0.3 : 0;
  return semantic * 0.55 + recency * 0.2 + authority;
}

function addCausalParents(selected: Set<string>, nodes: Map<string, CausalWeaveNode>, depth: number): void {
  let frontier = [...selected];
  for (let level = 0; level < depth; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const parent of nodes.get(id)?.parents ?? []) {
        if (selected.has(parent)) continue;
        selected.add(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }
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
      for (const parent of nodes.get(current)?.parents ?? []) {
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
