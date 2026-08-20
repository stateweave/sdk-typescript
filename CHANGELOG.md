# Changelog

## Unreleased

- Promote deterministic big-brain, peripheral, focus, and timeline projection into the public `Agent` compiler without compacting the append-only graph.
- Forward provider token and metadata events through `Agent.streamEvents()` while preserving ordinary action parsing and transactional commits; report peak context, provider-versus-estimated provenance, and complete cached input usage, with a persistent per-turn token chart in the development lab.
- Emit causal `verification` nodes for recognized successful post-mutation reads, syntax checks, and explicit application checks.
- Enforce prompt-budget and configuration validation, strengthen imported-state validation, and fail before provider invocation when mandatory context cannot fit.
- Bound protocol/completion retry failures by three consecutive retry iterations, resetting the streak after each accepted tool action instead of counting separated retries across the run trace.
- Add an isolated compound-node lab experiment comparing the current flat causal projection with a node that acts as both an outer node and an expandable subgraph; follow the exploratory ten-case pilots with a frozen 22-case difficult preregistered run.
- Add opt-in molecular context compilation over unchanged causal truth, deterministic molecule metadata in graph views, and a development-lab molecular graph with expandable/collapsible turn subgraphs.
- Replace browser-owned lab graph persistence with replay-safe server JSONL sessions: causal-node deltas, commit frontiers, failed-run records, periodic validated checkpoints, stale-writer fencing, torn-tail recovery, one-time localStorage migration, and token/chart restoration from the durable log.
- Add a primary dual-agent chat where every input concurrently runs unchanged StateWeave and a traditional persistent `messages[]` arm with identical tools in isolated workspaces; atomically persist both outcomes in paired JSONL, compact the traditional transcript at 48K into a summary plus six messages, and chart both arms' provider input/output, peak context, and compaction cost on one turn axis.
- Add a server-backed recent-session picker with ChatGPT-style conversation switching and New chat behavior; sessions are retained across resets and a new device opens the most recently updated saved conversation.
- Add a right-click/keyboard context menu for permanent paired-session deletion, removing the JSONL record containing both StateWeave and Traditional histories with confirmation.
- Add an unlimited play/pause long-horizon director that reads bounded paired history, generates fresh standalone prompts, sends each through both arms, and queues manual messages ahead of the next generated turn without interrupting an active run.

## 0.1.0

- Initial StateWeave SDK prototype.
- GraphFrame -> GraphOps -> StateGraph runtime.
- Anthropic-compatible model adapter.
- Tool interface with Zod validation.
- Interactive CLI with short-term graph memory, traditional messages comparison, and Mermaid graph output.
- Mintlify docs scaffold.
