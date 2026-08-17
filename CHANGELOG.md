# Changelog

## Unreleased

- Promote deterministic big-brain, peripheral, focus, and timeline projection into the public `Agent` compiler without compacting the append-only graph.
- Forward provider token and metadata events through `Agent.streamEvents()` while preserving ordinary action parsing and transactional commits.
- Emit causal `verification` nodes for recognized successful post-mutation reads, syntax checks, and explicit application checks.
- Enforce prompt-budget and configuration validation, strengthen imported-state validation, and fail before provider invocation when mandatory context cannot fit.
- Bound protocol/completion retry failures by three consecutive retry iterations, resetting the streak after each accepted tool action instead of counting separated retries across the run trace.
- Add an isolated compound-node lab experiment comparing the current flat causal projection with a node that acts as both an outer node and an expandable subgraph; follow the exploratory ten-case pilots with a frozen 22-case difficult preregistered run.

## 0.1.0

- Initial StateWeave SDK prototype.
- GraphFrame -> GraphOps -> StateGraph runtime.
- Anthropic-compatible model adapter.
- Tool interface with Zod validation.
- Interactive CLI with short-term graph memory, traditional messages comparison, and Mermaid graph output.
- Mintlify docs scaffold.
