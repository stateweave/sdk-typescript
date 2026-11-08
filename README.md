# StateWeave TypeScript SDK

[![CI](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml)
[![CodeQL](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7c3aed.svg)](./LICENSE)

StateWeave is a low-level TypeScript SDK for agents with immutable graph state instead of provider chat transcripts.

```txt
immutable causal graph → bounded working context → ordinary model action → causal graph
```

There is one public agent class: `Agent`.

**Built-in source recall:** every ordinary `Agent` automatically uses deterministic lexical ranking when bounded historical source retrieval is needed, with no external ranking provider, recall key, or opt-in flag. Small states retain ordinary projection. Historical evaluations remain frozen evidence for their original runtimes, not measurements of this runtime; no answer-quality superiority is claimed.

The runtime automatically records goals, model inferences, tool calls, tool results, resource versions, verification evidence, protocol errors, and answers as content-addressed causal nodes. Every model action points to the exact graph nodes compiled for that inference. The complete graph remains append-only while a deterministic multi-resolution projection keeps each model call bounded.

StateWeave does not expose `messages[]` as a primitive and does not require the model to author graph mutations. The model uses an ordinary `TOOL_CALL` / `FINAL` protocol; the runtime owns graph lineage. Recognized successful post-mutation reads, syntax checks, and explicit application checks are recorded as `verification` nodes linked to their tool evidence.

See [Agent engine](./docs/agent-engine.md) for the invariants and projection design.

## Installation

StateWeave intends to mirror the GitHub promotion flow with npm dist-tags once the initial package is published:

| GitHub branch | planned npm install |
| --- | --- |
| `development` | `pnpm add stateweave@dev` |
| `uat` | `pnpm add stateweave@uat` |
| `main` | `pnpm add stateweave` |

The package is currently source-only; use this path until the first authenticated npm publication:

```bash
git clone https://github.com/stateweave/sdk-typescript.git
cd sdk-typescript
pnpm install
pnpm test
```

## Quick start

Configure your answering-model credentials for `createModelFromEnv()`. Source recall is built in and requires no separate key, external ranking provider, or enable flag.

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
  projectionMaxNodes: 48,
  contextMode: "causal", // opt into "molecular" for a compact zoomable view
  maxNoProgressIterations: 100,
  enforceCompletionEvidence: true,
  nodeTypes: [
    { name: "preference", description: "A stable user preference." },
    { name: "wisdom", description: "A reusable evidence-supported lesson." },
    { name: "artifact", description: "A durable output or artifact reference." }
  ],
  allowDynamicNodeTypes: false,
  traceDir: ".stateweave/traces"
});
```

- `maxIterations` limits the internal model/tool loop for one user turn. It defaults to 30 and has no artificial SDK maximum.
- `maxPromptTokens` is the hard model-input ceiling and must be at least 256.
- `projectionTargetTokens` is the preferred bounded working context. Mandatory state may exceed the target but never the hard ceiling. If mandatory state cannot fit, the provider is not called. The SDK uses a conservative character-based token estimate rather than pretending to know every provider tokenizer.
- `projectionMaxNodes` caps detailed source nodes in one compiled view, including recalled sources. It defaults to 48.
- `contextMode: "molecular"` keeps the immutable causal graph unchanged but compiles deterministic outer-map molecules, expanded source atoms, and cross-molecule ports. The default remains `"causal"`; the development lab opts into molecular mode with a 16-node optional-detail target.
- `enforceCompletionEvidence` rejects unsupported coding-task finals when required inspection, mutation, checks, restart, or smoke evidence is absent.

### Native source recall

Native recall searches current source versions, deterministically ranks up to 64 exact interior excerpts by lexical relevance, and compiles up to 12 non-overlapping source windows under the existing node and token ceilings. The exact source-window representation and bounds are unchanged; text and original node identities remain intact. Ranking runs locally with no external ranking provider or recall credential. It cannot authorize actions, rewrite memories, or establish that omitted information is absent. Small bounded states retain ordinary projection.

`metadata.recall` and streamed `progress.recall` report lexical selection, source limits, latency, and actually visible windows; active lexical recall has status `lexical`. Main-model usage remains separate. Selection is prepared once per turn; newly observed tool evidence keeps its normal priority, and superseded source windows cannot reappear as current evidence. Under the same budgets, the immediately preceding request/answer and up to four direct current-goal parents retain ordinary views ahead of recalled history: a weak shortlist must not suppress a fresh correction or excerpt it away. No graph watcher or world-truth validator is implied.

The provider-agnostic `focusReranker` hook remains available for custom integrations. Historical `focus`/ranking diagnostics and separate usage accounting remain readable in stored traces and sessions; removing a bundled ranking provider does not erase previously recorded overhead.

### Migration from Jev-backed recall

Remove the `jev` option from `new Agent(...)` and remove imports of `JevConfiguration`, `JevSetupError`, and `createJevFocusReranker`; those options and exports are no longer available. The SDK no longer reads `TYPESAFE_API_KEY`, and the lab no longer accepts a `jevFocus` setting. Built-in deterministic lexical recall requires no replacement adapter or recall key. The generic `focusReranker` hook and its provider-agnostic types remain available for custom integrations.

Previously stored Jev focus diagnostics and usage labels remain readable as historical accounting; they are not renamed or erased. This migration makes no answer-quality, latency, cost, or other performance claim for the new runtime.

### Historical evaluation evidence

All files, reports, scores, and archives under `evaluations/` remain unchanged. The [native recall study](evaluations/native-recall-v1/CONFIRMATORY_RESULTS.md) and [focus diagnostic](evaluations/jev-focus-v2/REPORT.md) describe their frozen historical implementations, not the current deterministic lexical runtime. Their results must not be treated as measurements of, or superiority claims for, this runtime. Software tests verify the current contract, not better answers.

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
agent.getGraph(); // StateGraph visualization view with deterministic molecule metadata
agent.reset();
agent.reset(savedState);
```

Imported state is validated for node identity, causal parent ordering, sequence integrity, and frontier references.

## Semantic node types

The causal structure stays fixed, while semantic memory is configurable. The built-in types are `memory`, `preference`, `wisdom`, and `artifact`. The model may create these nodes inside the same ordinary tool or final response, so recording semantic state does not require a second model call.

```ts
const agent = new Agent({
  model,
  nodeTypes: [
    { name: "preference", description: "A stable user preference." },
    { name: "pros-cons", description: "A durable decision assessment." }
  ],
  allowDynamicNodeTypes: true
});
```

Each semantic node has a stable `type`, `key`, and arbitrary JSON `content`. Reusing the same type and key creates an immutable successor and makes the newest value authoritative in future projections. Set `allowDynamicNodeTypes` only when the agent should be allowed to invent a bounded lowercase type not present in `nodeTypes`.

## Streaming diagnostics

`agent.stream()` and `agent.streamText()` yield the accepted final answer as one string. `agent.streamEvents()` exposes the engine lifecycle and forwards provider token events while each model action is streaming:

```ts
for await (const event of agent.streamEvents("Inspect the workspace and fix the failing check")) {
  if (event.type === "metadata") console.log(event.metadata);
  if (event.type === "model_token") process.stdout.write(event.token);
  if (event.type === "model_metadata") console.log(event.metadata);
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
    kind: "system" | "goal" | "inference" | "semantic" | "tool_call" |
      "tool_result" | "resource" | "verification" | "answer" | "protocol_error";
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
- current resource and semantic heads;
- recent authoritative evidence;
- bounded operational closure;
- lexically relevant older nodes;
- a deterministic whole-graph digest of resources, mutations, tool activity, and recent recorded inference notes;
- a deterministic multi-resolution view: `<BIG_BRAIN>` topic pins, `<PERIPHERAL>` neighboring summaries, `<FOCUS>` detail, and `<TIMELINE>` chronology.

The view uses pure TypeScript topology, lexical retrieval, recency, and evidence authority. It is not an embedding index or a learned summary. Cluster ids are deterministic for the same graph. Equivalent repeated reads, calls, results, protocol errors, and superseded resource details collapse only in the model-facing projection. They remain present in the immutable source graph.

## Tool protocol

For one action the model returns:

```txt
TOOL_CALL {"name":"read_file","args":{"file_path":"src/app.ts"}}
```

After verified work it returns:

```txt
FINAL: Fixed the parser and verified the focused test.
```

Tool schemas are Zod-validated. The runtime executes only the first valid action envelope, records the call/result/resource lineage, emits recognized verification evidence, and makes failures visible on the next inference.

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

The internal development lab is separate from the public SDK and is not a public demo. The historical benchmark and frozen evaluation harnesses remain isolated internal evidence; they are not alternative public agent classes.

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
