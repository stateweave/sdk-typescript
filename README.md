# StateWeave

[![CI](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml)
[![CodeQL](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml)

StateWeave SDK is an experimental TypeScript SDK for StateWeave.dev. It treats agent runtime state as graph mutation instead of chat continuation.

Traditional agents pass:

```txt
messages[] -> LLM -> assistant message/tool call
```

StateWeave passes:

```txt
GraphFrame -> LLM -> streamed tokens -> GraphOps -> StateGraph update
```

The LLM is still a normal sequential model. The experiment is in the runtime protocol: the SDK gives the model a serialized `GraphFrame`, streams provider tokens, validates returned `GraphOps`, and mutates the graph.

## Why not just `messages[]`?

`messages[]` makes long-running work look like a transcript. Important facts, constraints, risks, tool results, and decisions are buried in prose. StateWeave makes those items first-class graph nodes and asks the model to produce explicit state changes.

The StateWeave SDK surface does not expose a chat-message primitive. Provider wire formats stay inside thin model adapters.

## Core concepts

### GraphFrame

A `GraphFrame` is the model's current working context:

- `objective`
- `currentFocus`
- `nextExpectedOutput`
- `activeConstraints`
- `availableActions`
- `graph`

### GraphOps

`GraphOps` are structured mutations returned by the model:

- `add_node`
- `add_edge`
- `update_node`
- `focus`
- `call_tool`
- `final`

The SDK parses model JSON, validates it with Zod, applies safe graph updates, executes tools, and inserts tool results back into the graph.

## Model primitives

StateWeave uses its own small model interface:

```ts
model.stream({ prompt, frame, mode: "graph_ops" })
```

Included providers:

- `MockModel` for deterministic local runs.
- `AnthropicModel` using plain `fetch`, with base URL, API key, model, max tokens, temperature, top-p, top-k, stop sequences, beta header, timeout, system prompt, and extra JSON parameters.

No Anthropic SDK, OpenAI SDK, LangChain, or LangGraph is used.

## Environment

Copy the example file:

```bash
cp .env.example .env
```

For local deterministic runs, keep:

```env
STATEWEAVE_MODEL_PROVIDER=mock
```

For Anthropic-compatible real provider calls, set either `anthropic` or `real`:

```env
STATEWEAVE_MODEL_PROVIDER=real
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_MAX_TOKENS=1024
ANTHROPIC_TEMPERATURE=0
ANTHROPIC_TOP_P=
ANTHROPIC_TOP_K=
ANTHROPIC_STOP_SEQUENCES=
ANTHROPIC_BETA=
ANTHROPIC_TIMEOUT_MS=60000
ANTHROPIC_SYSTEM=
ANTHROPIC_EXTRA_JSON=
```

## Install

```bash
pnpm install
```

## Run the demo

```bash
pnpm dev
```

This runs one StateWeave agent on the login refresh bug and writes JSON traces to `src/traces/`.

## Docs

Documentation lives in [`stateweave/docs`](https://github.com/stateweave/docs) and will be served at [stateweave.dev](https://stateweave.dev).

## Inspect runs from the interactive CLI

```bash
pnpm cli
```

Type one task into the prompt:

```txt
stateweave › Find why login fails after token refresh. Login fails after refresh. Do not rewrite the auth system.
```

Or pass one input directly:

```bash
pnpm cli "Find why login fails after token refresh. Login fails after refresh. Do not rewrite the auth system."
```

The CLI uses one StateWeave input and derives the initial `GraphFrame`. It prints a compact, colored view of:

- model input state: `GraphFrame` summary and current graph
- raw streamed model output
- parsed `GraphOps`
- updated state after applying ops and tool results
- final answer
- optional Mermaid graph output for Obsidian-style visualization

Commands inside the CLI:

```txt
/prompt   toggle exact prompt passed to the provider adapter
/compare  toggle traditional messages comparison
/graph    toggle Mermaid graph output
/reset    clear short-term graph memory
/full     show full GraphFrame JSON
/compact  return to compact graph view
/exit     quit
```

One-shot flags:

```bash
pnpm cli --input "Diagnose the API response shape mismatch" --prompt --compare --graph
pnpm cli "Explain the failing payment test. Do not rewrite payments." --full
```

## Stream frames and tokens

```ts
for await (const event of agent.stream("Find why login fails after token refresh. Do not rewrite auth.")) {
  if (event.type === "frame") console.log(event.phase, event.frame);
  if (event.type === "token") process.stdout.write(event.token);
}
```

Interactive CLI runs keep short-term graph memory between inputs until `/reset`.

Every trace step stores:

- `frameBefore`
- `prompt`
- `tokenEstimate` with `messageCount: 0`
- `streamedTokens`
- `rawModelOutput`
- `parsedOps`
- `frameAfter`

## Run evals

```bash
pnpm eval
```

The eval compares a flat-transcript baseline with the StateWeave graph primitive and prints:

```txt
Task | Traditional messages success | StateWeave success | Traditional steps | StateWeave steps | Notes
```

## Run tests

```bash
pnpm test
```

Test files sit in:

- `tests/graph.test.ts`
- `tests/applyOps.test.ts`

Runtime entry points sit in:

- `src/index.ts` for the fixed demo
- `src/cli.ts` for manual inspection
- `src/evals/runEval.ts` for traditional messages vs StateWeave evals

## Publishing

The package is prepared for public npm publishing via GitHub Releases. Add an `NPM_TOKEN` repository secret, create a release, and `.github/workflows/npm-publish.yml` will run tests, build, and publish with npm provenance.

Docs image publishing to GitHub Container Registry is prepared in `.github/workflows/docs-image.yml`.

## Current limitations

- Graph is plain in-memory JSON.
- Anthropic's public HTTP API still has its own wire schema internally; StateWeave does not expose that as the SDK primitive.
- The prompt contract depends on model compliance with JSON-only output.
- Tooling is deterministic and fake by design.
- Eval tasks are toy examples.
- No UI, no LangGraph, no graph database.

The purpose is to prove the primitive: can structured state mutation be a better runtime unit than a flat transcript?
