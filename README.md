# StateWeave TypeScript SDK

StateWeave provides inspectable graph-state primitives and one public `Agent` class.

```text
GraphFrame -> GraphOps -> StateGraph
```

The primitive pipeline compiles a graph frame, parses and validates operations, and applies them to a new state without mutating the prior snapshot. The public `Agent` has a separate causal-memory runtime with ordinary model actions; it does not use GraphFrame as its memory engine or ask the model to author GraphOps. StateWeave does not expose `messages[]` as a primitive.

## Develop from source

Requires Node.js 22+ and pnpm 11.9.0.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm package:check
```

## Inspect the primitives

```ts
import {
  createInitialGraphFrame,
  serializeGraphFrame,
  parseAndValidateOps,
  applyOps
} from "stateweave";

const before = createInitialGraphFrame({
  objective: "Inspect one graph transition",
  input: "Remember that the release window is Friday.",
  availableActions: []
});

const prompt = serializeGraphFrame(before);
const ops = parseAndValidateOps('SW2\nN release fact "Release window: Friday"\nF "Recorded Friday."');
const after = applyOps(before, ops);

console.log({ prompt, ops, before: before.graph, after: after.graph });
```

This example applies supplied operations, not an evaluation or a model answer.

### One-task CLI

```bash
pnpm cli --input "My name is Ada" --graph
printf 'My name is Ada\n' | pnpm cli
pnpm dev
```

The CLI shows the actual GraphFrame, raw output, validated GraphOps, and resulting StateGraph. By default it uses deterministic offline `MockModel` fixtures; fixture answers do not establish task correctness. It performs one transaction, executes no tools, and keeps no session or transcript baseline. Add `--prompt` to inspect the exact compiled prompt.

The default is always `MockModel`, even when provider environment variables are present. Only `pnpm cli --live --input "..."` opts into the environment-configured model; it may incur provider charges. The CLI never loads `.env`. Callers may load configuration externally (for example, with Node's `--import dotenv/config`) only when they intend to use it. There are no automatic paid probes or retries.

### Manual web inspector

```bash
pnpm web:dev
pnpm web:check
pnpm web:build
```

The web inspector uses the graph primitives directly in the browser. It has no model, provider connection, credentials, backend, or scoring. It is a manual state inspector, not an evaluation runner.

## Public Agent

Configure a model only when you intend to call it:

```ts
import { Agent, createModelFromEnv } from "stateweave";

const model = createModelFromEnv();
const agent = new Agent({ model });
await agent.run("Inspect the workspace.");

console.log(agent.getState());
console.log(agent.getGraph());

const resumed = new Agent({ model, state: agent.getState() });
```

`createModelFromEnv()` selects a mock model without provider configuration; configured providers can incur charges. Provider adapters are thin model/HTTP primitives.

`Agent` includes workspace-scoped `read_file`, `write_file`, `edit_file`, and read-only `bash_command` tools. Pass `tools` to replace them. File tools reject traversal and symlink escapes; the shell tool is a no-profile read-only allowlist, not arbitrary shell access. `maxIterations` defaults to 30; increase it explicitly when needed.

Agent state imports are validated. Calls serialize in invocation order and commit only on success; failed or aborted runs do not replace committed state. `streamEvents()` exposes compiled context, model actions, tools, and immutable causal lineage for diagnostics. Regression tests cover graph integrity, provenance, state safety, and tool containment; passing tests are not evidence of better model answers.

## Comparison status

The previous evaluation systems, datasets, and reports have been removed from the active tree; Git history retains them. There is no current baseline, live comparison runner, or result.

A fresh comparison must use `GraphFrame -> GraphOps -> StateGraph` directly, not `Agent`. The user selected the current StateWeave SDK code/docs as the source for fresh product-derived task proposals. The selected workflow is multi-turn JSON/SVG workspace editing grounded in retained SDK tool/runner regressions. The five synthetic seeds in `eval/workspace-editing-v1/cases.json` have input approval; they are not production traffic. Their deterministic actual-output grader remains under separate review. Provider/model, execution/token budgets, and any expanded cohort still need approval. Do not recycle deleted cases or harnesses, invent a baseline, or automatically run experiments. No model/provider change, corpus, benchmark result, or performance claim is implied by this clean start.

## Release safety

Promotion proceeds through development, UAT, then production. Source changes and local package checks do not publish or deploy anything. Publishing, deployment, credential use, and paid model runs require explicit authority.
