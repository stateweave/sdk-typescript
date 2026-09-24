import type { CausalWeaveNode } from "./causalTypes.js";

export type SemanticAlias = { from: string; to: string };

export function optionalSemanticAliases(
  input: SemanticAlias[] | undefined,
  nodes: Map<string, CausalWeaveNode>,
  eligible: Set<string>,
  frontier: Set<string>,
  goalSequence: number
): SemanticAlias[] {
  if (!Array.isArray(input) || !input.length) return [];
  if (input.some((alias) => !alias || typeof alias.from !== "string" || typeof alias.to !== "string")) return [];
  if (input.length > 256) throw new Error("At most 256 semantic aliases are allowed.");
  const sources = new Set(input.map((alias) => alias.from));
  if (sources.size !== input.length || input.some((alias) => sources.has(alias.to))) return [];
  return input.filter(({ from, to }) => {
    const source = nodes.get(from), target = nodes.get(to);
    if (!source || !target || !eligible.has(from) || !eligible.has(to) || frontier.has(from)) return false;
    if (source.kind !== "semantic" || target.kind !== "semantic" || source.sequence >= target.sequence || source.sequence >= goalSequence) return false;
    const left = source.payload as { type?: unknown; content?: unknown } | null;
    const right = target.payload as { type?: unknown; content?: unknown } | null;
    return typeof left?.type === "string" && left.type === right?.type && typeof left.content === "string" && typeof right.content === "string";
  });
}
