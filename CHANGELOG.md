# Changelog

## Unreleased

- Promote deterministic big-brain, peripheral, focus, and timeline projection into the public `Agent` compiler without compacting the append-only graph.
- Forward provider token and metadata events through `Agent.streamEvents()` while preserving ordinary action parsing and transactional commits.
- Emit causal `verification` nodes for recognized successful post-mutation reads, syntax checks, and explicit application checks.
- Enforce prompt-budget and configuration validation, strengthen imported-state validation, and fail before provider invocation when mandatory context cannot fit.
- Bound protocol/completion retry failures by three consecutive retry iterations, resetting the streak after each accepted tool action instead of counting separated retries across the run trace.

## 0.1.0

- Initial StateWeave SDK prototype.
- GraphFrame -> GraphOps -> StateGraph runtime.
- Anthropic-compatible model adapter.
- Tool interface with Zod validation.
- Interactive CLI with short-term graph memory, traditional messages comparison, and Mermaid graph output.
- Mintlify docs scaffold.
