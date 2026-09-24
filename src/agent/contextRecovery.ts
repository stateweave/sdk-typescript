import type { CausalWeaveSnapshot } from "../core/causalTypes.js";

export type ContextRecovery = (
  input: { query: string; state: CausalWeaveSnapshot; compiled: { prompt: string; nodeIds: string[] } },
  signal?: AbortSignal
) => Promise<string[]>;
