# StateWeave Roadmap

StateWeave is a low-level runtime primitive for agent state:

```txt
GraphFrame -> model -> GraphOps -> StateGraph
```

This roadmap is directional, not a guarantee. The project should stay small, inspectable, and provider-neutral.

## v0.1 — Prove the primitive

Status: in progress

- [x] Core TypeScript types for `GraphFrame`, `StateGraph`, `GraphNode`, `GraphEdge`, and `GraphOp`
- [x] Prompt serialization from `GraphFrame`
- [x] Zod validation for model-produced `GraphOps`
- [x] In-memory graph mutation
- [x] Tool interface with Zod schemas
- [x] Mock deterministic tools
- [x] Anthropic-compatible HTTP adapter
- [x] Interactive CLI with model-in/model-out inspection
- [x] Short-term graph memory in the CLI
- [x] Mermaid graph output
- [x] Traditional messages comparison mode
- [x] Mintlify docs in `stateweave/docs`

## v0.2 — Stabilize the SDK surface

- [ ] Freeze the first public TypeScript API shape
- [ ] Add stronger GraphOps recovery for malformed provider output
- [ ] Add adapter examples for OpenAI-compatible and local HTTP models without adding provider SDK dependencies
- [ ] Add pluggable trace sinks
- [ ] Add graph compaction utilities
- [ ] Add more tests around multi-turn short-term memory
- [ ] Add package-level API reference generated from TypeScript declarations

## v0.3 — Better developer experience

- [ ] Publish the first npm package
- [ ] Add CLI install docs after npm release
- [ ] Add more realistic coding-agent examples
- [ ] Add structured eval examples that compare messages vs GraphFrame context
- [ ] Add import/export helpers for graph snapshots
- [ ] Add docs for production trace hygiene and prompt privacy

## v0.4 — Interop and visualization

- [ ] JSON Schema for GraphFrame and GraphOps
- [ ] Mermaid and Cytoscape export helpers
- [ ] Event stream format for live graph UIs
- [ ] Prototype protocol fixtures for Python and Rust implementations
- [ ] Define compatibility tests for other language SDKs

## Future repositories

The StateWeave organization is intentionally split by product surface:

```txt
stateweave/sdk-typescript   TypeScript SDK and CLI
stateweave/docs             Mintlify docs and docs deployment
stateweave/spec             Protocol/specification, JSON schemas, fixtures
stateweave/sdk-python       Future Python SDK
stateweave/sdk-rust         Future Rust SDK
stateweave/graph-ui         Future 3D/live graph UI for agent state
stateweave/examples         Larger runnable examples
```

## Non-goals for now

- No graph database requirement
- No UI dependency in the core SDK
- No LangGraph/LangChain dependency in the core SDK
- No hidden transcript abstraction behind the GraphFrame runtime
- No provider lock-in
