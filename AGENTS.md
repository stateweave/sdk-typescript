# AGENTS.md

StateWeave TypeScript SDK is a low-level SDK primitive, not a wrapper around AI-engineering frameworks.

- Keep the runtime centered on `GraphFrame -> GraphOps -> StateGraph`.
- Do not expose `messages[]` as a StateWeave primitive except in traditional comparison utilities.
- CLI/manual inspection should accept one user task input, then show GraphFrame/GraphOps/state transitions clearly; optional graph visualization should stay dependency-free and low-level.
- Provider adapters should be thin HTTP/model primitives.
- Never read `.env`; it may contain real third-party LLM API keys. Let commands load it without printing it.
- Keep code clean, deliberate, and organized; avoid duplicate helpers, orphan files, and abstraction for its own sake.
- Use minimal comments; prefer clear types and names.
