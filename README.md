# StateWeave TypeScript SDK

[![CI](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml)
[![CodeQL](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7c3aed.svg)](./LICENSE)

StateWeave is a low-level TypeScript SDK for agents with immutable graph state instead of provider chat transcripts.

```txt
immutable causal graph → bounded working context → ordinary model action → causal graph
```

There is one public agent class: `Agent`.

The runtime automatically records goals, model inferences, tool calls, tool results, resource versions, protocol errors, and answers as content-addressed causal nodes. Every model action points to the exact graph nodes compiled for that inference. The complete graph remains append-only while a deterministic projection keeps each model call bounded.

StateWeave does not expose `messages[]` as a primitive and does not require the model to author graph mutations. The model uses an ordinary `TOOL_CALL` / `FINAL` protocol; the runtime owns graph lineage.

See [Agent engine](./docs/agent-engine.md) for the invariants and projection design.

## Installation

StateWeave dist-tags mirror the promotion flow:

| GitHub branch | npm install |
| --- | --- |
| `development` | `pnpm add stateweave@dev` |
| `uat` | `pnpm add stateweave@uat` |
| `main` | `pnpm add stateweave` |

From source:

```bash
git clone https://github.com/stateweave/sdk-typescript.git
cd sdk-typescript
pnpm install
pnpm test
```

## Quick start

```ts
import { Agent, createModelFromEnv } from "stateweave";

const agent = new Agent({
  model: createModelFromEnv()
});

for await (const chunk of agent.stream("Create a tiny HTML todo app in ./todo")) {
  process.stdout.write(chunk);
}

await agent.run("Add keyboard shortcuts.");
console.log(agent.getState());
console.log(agent.getGraph());
```

`Agent` includes workspace-scoped `read_file`, `write_file`, `edit_file`, and read-only `bash_command` tools by default. Pass `tools` to replace the default set.

Important options:

```ts
const agent = new Agent({
  model,
  tools,
  systemPrompt: "You are a careful product engineer.",
  maxIterations: 30,
  maxPromptTokens: 64_000,
  projectionTargetTokens: 16_000,
  maxNoProgressIterations: 100,
  enforceCompletionEvidence: true,
  traceDir: ".stateweave/traces"
});
```

- `maxIterations` limits the internal model/tool loop for one user turn. It defaults to 30 and has no artificial SDK maximum.
- `maxPromptTokens` is the hard model-input ceiling.
- `projectionTargetTokens` is the preferred bounded working context. Mandatory state may exceed the target but never the hard ceiling.
- `enforceCompletionEvidence` rejects unsupported coding-task finals when required inspection, mutation, checks, restart, or smoke evidence is absent.

## Persistent state

A single `Agent` owns one session graph. Stateful calls are serialized in invocation order. Successful runs commit; failed or aborted runs return diagnostic state on `AgentRunError` but do not overwrite the agent’s committed state.

```ts
const first = await agent.run("Remember that the release window is Friday.");
const state = first.state;

const resumed = new Agent({ model, state });
const second = await resumed.run("When is the release window?");
```

Use:

```ts
agent.getState(); // lossless AgentState
agent.getGraph(); // StateGraph visualization view
agent.reset();
agent.reset(savedState);
```

Imported state is validated for node identity, causal parent ordering, sequence integrity, and frontier references.

## Streaming diagnostics

`agent.stream()` yields final answer text. `agent.streamEvents()` exposes the engine lifecycle:

```ts
for await (const event of agent.streamEvents("Inspect the workspace and fix the failing check")) {
  if (event.type === "metadata") console.log(event.metadata);
  if (event.type === "progress") {
    console.log(event.progress.phase, event.progress.detail);
    console.log(event.progress.prompt); // exact compiled context when available
    console.log(event.progress.graph);  // current visualization view
  }
  if (event.type === "final") console.log(event.result);
}
```

Each trace step records the compiled node ids, exact prompt, context-token estimate, raw model output, action type, tool name, and any protocol error. Run metadata includes model/tool calls and provider or estimated token totals.

## Agent state

```ts
type AgentState = {
  version: 1;
  nodes: Array<{
    id: string;
    kind: "system" | "goal" | "inference" | "tool_call" | "tool_result" |
      "resource" | "verification" | "answer" | "protocol_error";
    parents: string[];
    payload: unknown;
    createdAt: string;
    sequence: number;
    resourceKey?: string;
  }>;
  frontier: string[];
};
```

Node identity is SHA-256 over kind, sorted parents, payload, and optional resource key. Timestamps and insertion sequence are metadata, not identity.

The defining invariant is:

> A model action’s parents are exactly the graph nodes selected for that inference.

The runtime knows this read set, so causal lineage requires no extra model syntax or second model call.

## Projection

The compiler selects:

- system and goal roots;
- the active frontier;
- current resource heads;
- recent authoritative evidence;
- bounded operational closure;
- lexically relevant older nodes;
- a deterministic whole-graph digest of resources, mutations, tool activity, and recent recorded inference notes.

Equivalent repeated reads, calls, results, protocol errors, and superseded resource details collapse only in the model-facing projection. They remain present in the immutable source graph.

## Tool protocol

For one action the model returns:

```txt
TOOL_CALL {"name":"read_file","args":{"file_path":"src/app.ts"}}
```

After verified work it returns:

```txt
FINAL: Fixed the parser and verified the focused test.
```

Tool schemas are Zod-validated. The runtime executes only the first valid action envelope, records the call/result/resource lineage, and makes failures visible on the next inference.

The default file tools reject absolute paths, traversal, and symlink components. The default `bash_command` is a no-profile read-only allowlist with a fixed trusted `PATH`; it rejects pipes, redirects, command substitution, arbitrary interpreters, network commands, and symlink-following flags.

## Connect a model

StateWeave uses a small provider-neutral interface:

```ts
import type { Model } from "stateweave";

const model: Model = {
  async complete(input) {
    return { text: "FINAL: Done." };
  },
  async *stream(input) {
    yield { type: "token", token: (await this.complete(input)).text };
  }
};
```

Included adapters:

- `MockModel` for deterministic tests.
- `AnthropicModel` as a thin HTTP adapter.
- `createModelFromEnv()` for environment-selected construction.

StateWeave keeps provider adapters thin. Provider APIs still receive a linear token sequence because current transformers require one; that sequence is a temporary compilation of graph state, not stored chat history.

## CLI and lab

```bash
pnpm cli
```

Useful commands:

```txt
/prompt   show the exact compiled causal context
/graph    show a Mermaid graph
/full     show lossless AgentState JSON
/compact  show a compact state view
/compare  compare with a traditional transcript
/reset    clear agent state
```

The development lab is available at `https://dev.stateweave.dev/lab/`. Its primary chat runs the same public `Agent`, keeps `AgentState` in the browser, streams causal progress, and visualizes the graph. The historical benchmark and frozen evaluation harnesses remain isolated internal evidence; they are not alternative public agent classes.

## Low-level graph utilities

`GraphFrame`, `GraphOps`, and `StateGraph` utilities remain exported for low-level graph construction, visualization, and historical artifact compatibility. The public `Agent` runtime no longer asks the model to author GraphOps and does not use GraphFrame as its memory engine.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm web:check
pnpm web:build
```

StateWeave has no LangChain/LangGraph dependency, provider SDK dependency, or graph database dependency.

## License

MIT
