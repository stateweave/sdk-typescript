# AGENTS.md

StateWeave TypeScript SDK is a low-level SDK primitive, not a wrapper around AI-engineering frameworks.

- Keep the runtime centered on `GraphFrame -> GraphOps -> StateGraph`.
- Do not expose `messages[]` as a StateWeave primitive. The primary web lab chat is StateWeave-only; a separate A/B testing tab may invoke a regular messages baseline for comparison only.
- CLI/manual inspection should accept one user task input, then show GraphFrame/GraphOps/state transitions clearly; optional graph visualization should stay dependency-free and low-level.
- Provider adapters should be thin HTTP/model primitives.
- Never read `.env`; it may contain real third-party LLM API keys. Let commands load it without printing it.
- Keep code clean, deliberate, and organized; avoid duplicate helpers, orphan files, and abstraction for its own sake.
- Use minimal comments; prefer clear types and names.
- StateWeave SDK npm promotion: `development` branch publishes `stateweave@dev`, `uat` branch publishes `stateweave@uat`, and `main` publishes `stateweave@latest`. Use GitHub Environments `development`, `uat`, and `production`; do not skip promotion stages unless explicitly approved.
- Architecture thesis: StateGraph replaces provider `messages[]`. The graph starts from a system/root node, can later add system nodes anywhere, and the root can point/follow the active system node. Each model call receives a compiled GraphFrame/subgraph view, not messages; GraphOps grow/traverse the graph intelligently and may eventually run async/parallel over multiple graph regions.
- Model graph output should use SWX/1 (StateWeave Exchange): compact `@node`/`@edge`/`@final` line commands plus raw `<<<artifact:mime ... >>>` blocks for SVG/HTML/code/artifacts. Do not force creative artifacts through JSON strings.
- Web lab A/B tests must use the same neutral provider system prompt for both regular messages and StateWeave. The shared prompt should explain both variants without favoring either; only the input/state format should differ.
- Web lab prompt eval tabs are blind multi-turn A/B evals: Prompt one has ten connected brand/memory prompts; Prompt two has twenty-five math/physics prompts; Prompt three has thirty harder gold-answer math/logic/physics prompts. Gold answers are shown only in UI, never sent to either variant. User votes A/B/both/neither, and labels are revealed only after all votes.
