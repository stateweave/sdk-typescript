# Contributing to StateWeave

StateWeave is intentionally small. The core runtime primitive is:

```txt
GraphFrame -> GraphOps -> StateGraph
```

Contributions are welcome when they make that primitive clearer, safer, easier to inspect, or easier to integrate.

## Local setup

```bash
git clone https://github.com/stateweave/sdk-typescript.git
cd sdk-typescript
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Optional CLI smoke test:

```bash
STATEWEAVE_MODEL_PROVIDER=mock pnpm cli "Hi my name is Radi." --graph --compare
```

## Before opening a PR

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

If your change touches model adapters or graph mutation, add or update tests.

## Pull request structure

Use this shape in your PR description:

```md
## Summary
What changed and why?

## Primitive impact
Does this affect GraphFrame, GraphOps, StateGraph, tools, traces, CLI, or model adapters?

## Testing
- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm build
- [ ] manual CLI check, if relevant

## Security/privacy
Does this touch provider keys, env vars, traces, prompts, or network calls?
```

## PR guidelines

- Keep PRs small and focused.
- Prefer readable types over broad abstractions.
- Do not expose `messages[]` as the StateWeave runtime primitive.
- Traditional messages are allowed only for comparison utilities and docs.
- Keep provider adapters thin and HTTP-level.
- Avoid adding framework dependencies to the core SDK.
- Do not commit `.env`, API keys, trace JSON, private prompts, or production data.
- Do not include generated `dist/`, `coverage/`, or local trace files.

## Branch naming

Use short names:

```txt
fix/graph-op-validation
feat/model-adapter-example
docs/quickstart-tools
cli/compact-graph-view
```

## Commit style

Use concise imperative commits:

```txt
Add GraphOps recovery test
Document tool adapter contract
Fix duplicate graph edge handling
```

## Tests

Current test areas:

```txt
tests/graph.test.ts
tests/applyOps.test.ts
```

Useful commands:

```bash
pnpm typecheck
pnpm test
pnpm eval
pnpm build
```

## Documentation

Documentation lives in a separate repo:

```txt
https://github.com/stateweave/docs
```

If an SDK change affects onboarding, model adapters, tools, traces, or CLI behavior, open a matching docs PR.

## Security

See [`SECURITY.md`](./SECURITY.md). If you find a vulnerability, do not open a public issue with exploit details.
