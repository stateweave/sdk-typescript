# Contributing

StateWeave is intentionally small. Keep changes focused on the low-level primitive:

```txt
GraphFrame -> GraphOps -> StateGraph
```

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Guidelines

- Do not expose `messages[]` as the StateWeave runtime primitive.
- Keep provider adapters thin and HTTP-level.
- Avoid framework dependencies in core runtime code.
- Do not commit `.env`, trace JSON, API keys, or private prompts.
- Prefer small, readable types over broad abstractions.
