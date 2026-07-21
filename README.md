# StateWeave TypeScript SDK

[![CI](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml)
[![CodeQL](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7c3aed.svg)](./LICENSE)

StateWeave is a low-level TypeScript SDK for building agents around graph state instead of chat transcripts.

```txt
GraphFrame -> model -> GraphOps -> StateGraph
```

The model is still a normal transformer. StateWeave changes the runtime primitive around it: the SDK serializes a structured graph frame, asks the model for validated operations, applies them to an in-memory graph, and exposes every state transition for inspection.

Experimental **Causal Weave (Variant C)** explores a second graph-native primitive: immutable content-addressed causal nodes, an active frontier, and ordinary tool actions whose parents are exactly the graph nodes compiled for that inference. It does not use `messages[]` or model-authored GraphOps. See [`docs/causal-weave.md`](./docs/causal-weave.md).

The current runtime uses a Cortex-style focus model: `system_root` anchors the graph, new user inputs enter as pending nodes, and `GraphFrame` carries `focusNodeId`, `activeUserInputNodeId`, and candidate focus points. The model then returns GraphOps edges deciding whether the input starts a new root-level branch, continues a prior node, updates an output, or relates elsewhere. GraphOps apply transactionally: disconnected pending inputs or new semantic/output nodes are rejected and retried with structured error feedback. Runs expose trace metadata and can stream model-call frames, output tokens, parsed GraphOps, retry errors, and final results. Only runtime nodes are structural (`system`, `user_input`, `assistant_output`, `tool_call`, `tool_result`); all other node types are model-created semantic slugs.

## Why StateWeave?

Traditional agent runtimes pass transcript-shaped context:

```txt
messages[] -> LLM -> assistant message/tool call
```

That works, but important state is buried in prose: facts, constraints, risks, tool results, hypotheses, and decisions.

StateWeave makes those first-class:

```txt
GraphFrame -> LLM -> GraphOps -> updated StateGraph
```

This makes agent state easier to inspect, visualize, persist, test, and debug.

## Status

StateWeave is experimental. The core primitive is intentionally small and readable.

- No LangChain or LangGraph dependency.
- No provider SDK dependency.
- No graph database.
- No hidden message-history abstraction.
- In-memory JSON graph for the MVP.
- Built-in workspace tools: `read_file`, `write_file`, `edit_file`, and `bash_command`.
- Cortex-style graph focus/branching over transcript replay.
- Transactional GraphOps validation rejects orphan/disconnected graph mutations before commit.
- Streamable model internals: metadata, compiled prompt, token stream, parsed GraphOps, retries, and final trace.
- Web lab trace JSON is persisted under `STATEWEAVE_TRACE_DIR` (Docker default `/data/traces`).

## Installation

StateWeave uses npm dist-tags that mirror the GitHub promotion flow:

| GitHub branch | GitHub environment | npm install |
| --- | --- | --- |
| `development` | development | `pnpm add stateweave@dev` |
| `uat` | uat | `pnpm add stateweave@uat` |
| `main` | production | `pnpm add stateweave` |

From source:

```bash
git clone https://github.com/stateweave/sdk-typescript.git
cd sdk-typescript
pnpm install
pnpm test
```

Quick start:

```ts
import { Agent, createModelFromEnv } from "stateweave";

const agent = new Agent({
  model: createModelFromEnv(),
  nodeTypes: ["intent", "constraint", "artifact", "decision"]
});

for await (const chunk of agent.stream("Create a tiny HTML todo app in ./todo")) {
  process.stdout.write(chunk);
}

await agent.run("Add keyboard shortcuts.");
console.log(agent.getFrame()?.graph.nodes);
```

`Agent` includes workspace file-system tools by default, so it can read, write, edit, and run shell commands in its workspace without extra setup. File tools reject absolute paths, traversal, and symlink components. The read-only bash allowlist runs without shell startup profiles, with a fixed trusted `PATH`, and rejects symlink-following flags and glob expansion.

`nodeTypes` is an ordered list of preferred semantic types, not a whitelist. StateWeave shows the list explicitly in every `GraphFrame` prompt and instructs the model to use a configured type whenever it fits; the model may still create a precise custom `lower_snake_case` type when none applies. Tool-using turns preserve a semantic work record: an active task/intent before the first tool, durable constraints/files/symbols/decisions around it, and evidence-linked verification before resolution.

## Quickstart

A single `Agent` owns a session `GraphFrame`. Every successful `run` or `stream` commits a new `user_input_N` and its result to that graph unless you pass an explicit frame. Stateful calls are serialized in invocation order so a later turn sees the prior committed result; failed, aborted, or reset-invalidated work is not committed. Explicit-frame calls are independent and may run concurrently.

`maxIterations` is the recursion limit for the internal model/tool loop for one user input. It defaults to `30`; if the loop is exhausted, StateWeave raises a recursion-limit error suggesting a higher `maxIterations`. The SDK/web lab do not impose an artificial upper cap. It is not a max-turn setting; user turns are just more graph nodes.

`maxPromptTokens` is the hard model-input budget for each compiled `GraphFrame` and defaults to `64_000`. StateWeave recursively summarizes bulky tool metadata, prioritizes the active input and focused/retrieved graph regions, and omits optional projection lines before crossing the budget. If mandatory state cannot fit, the SDK fails locally before calling the provider. Set this below the provider model's context window, leaving room for output tokens.

Quality gates are evidence-based. `edit_file` requires a prior read of that path (or a file created earlier in the same run); failed or unsuccessful tool results reject semantic mutations from that transaction; requested checks, restarts, and smoke tests must each have matching successful tool evidence; and configured tool-using agents must resolve their semantic task and connect a resolved verification result to both the tool evidence and task before finalizing. Current file/tool evidence always outranks an earlier assistant summary.

Use `streamEvents()` when you want the full trace stream, including GraphOps and built-in graph worker scheduler events:

```ts
for await (const event of agent.streamEvents("Inspect the graph")) {
  console.log(event);
}
```

Models can spawn focused graph workers with SWX `@worker` operations. Workers run StateWeave on focused graph regions, merge validated graph branches back into the shared StateGraph, then the parent loop synthesizes one final answer from `worker_result` nodes.

The default toolset is workspace-scoped file-system access. For deterministic local tests, import and pass `mockTools` explicitly. To extend the default toolset, pass `tools: [...createDefaultTools(), yourTool]`.

## Run the demo CLI

```bash
pnpm cli
```

Then type one input:

```txt
stateweave › Hi my name is Radi.
stateweave › What is my name?
```

The CLI keeps short-term graph memory during the session. Use `/reset` to clear it.

Useful commands:

```txt
/prompt   show the exact prompt sent to the model
/compare  show traditional messages side-by-side
/graph    print a Mermaid graph of the StateGraph
/full     show full GraphFrame JSON
/compact  return to compact state view
/exit     quit
```

One-shot inspection:

```bash
pnpm cli "Find why login fails after token refresh. Login fails after refresh." --compare --graph
```

## Connect a model

StateWeave uses a tiny model interface:

```ts
import type { Model } from "stateweave";

const model: Model = {
  async complete(input) {
    let text = "";
    for await (const event of this.stream(input)) {
      if (event.type === "token") text += event.token;
    }
    return { text };
  },

  async *stream(input) {
    const response = await fetch("https://provider.example.com/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt })
    });

    yield { type: "token", token: await response.text() };
  }
};
```

Included adapters:

- `MockModel` for deterministic local demos/tests.
- `AnthropicModel` as a thin HTTP adapter with configurable base URL, API key, model, temperature, top-p, top-k, stop sequences, beta header, timeout, and extra payload fields.

Environment example:

```env
STATEWEAVE_MODEL_PROVIDER=real
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_MAX_TOKENS=8192
ANTHROPIC_TEMPERATURE=0
```

## Built-in workspace tools

Tools are Zod-validated functions. Tool calls become `tool_call` / `tool_result` nodes in the graph, then the next model step receives the updated `GraphFrame`.

`Agent` includes these workspace-scoped tools by default:

| Tool | Args |
| --- | --- |
| `read_file` | `file_path`, optional `offset`, `limit` |
| `write_file` | `file_path`, `content` |
| `edit_file` | `file_path`, `old_string`, `new_string`, optional `replace_all` |
| `bash_command` | `command`, optional `timeout_ms` |

The file tool argument names match the common LangChain filesystem convention. `path`, `oldText`, `newText`, `replaceAll`, `startLine`, and `maxLines` are accepted as compatibility aliases, but new code should use the table above.

For multiline HTML/SVG/code or exact edit strings, SWX uses raw block references instead of escaping giant JSON strings:

```txt
@tool write_file file_path=logo.svg content_ref=svg_1
<<<svg_1:image/svg+xml
<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>
>>>
```

```txt
@tool edit_file file_path=README.md old_string_ref=old_1 new_string_ref=new_1
<<<old_1:text/plain
old exact text
>>>
<<<new_1:text/plain
new exact text
>>>
```

Final answers are always human-readable text. Use inline `@final` for short responses and `@final_ref` for long responses, with optional artifact references:

```txt
@final "Created the SVG and wrote it to logo.svg." artifact=logo_svg
```

```txt
@final_ref final_answer artifacts=snake,index_page
<<<final_answer:text/markdown
Created the game files:
- snake.html
- index.html
>>>
```

To add custom tools without losing the defaults, pass `tools: [...createDefaultTools(), yourTool]`. To replace the defaults entirely, pass your own `tools` array.

## Visualize graph state

State graphs can be rendered as Mermaid for low-level inspection.

```ts
import { graphToMermaid } from "stateweave";

console.log(graphToMermaid(result.graph));
```

CLI:

```bash
pnpm cli "Diagnose the API response shape mismatch." --graph
```

## Trace everything

Each step records:

```ts
type TraceStep = {
  step: number;
  frameBefore: GraphFrame;
  prompt: string;
  tokenEstimate: { estimatedTokens: number; messageCount: number };
  streamedTokens: string[];
  rawModelOutput: string;
  parsedOps: GraphOp[];
  frameAfter: GraphFrame;
};
```

For StateWeave graph steps, `messageCount` is `0`.

## Repository structure

```txt
src/
  core/      GraphFrame, StateGraph, validation, serialization, graph ops
  llm/       model interface and provider adapters
  tools/     tool interface and deterministic mock tools
  agent/     StateWeave agent and traditional comparison agent
  evals/     toy baseline-vs-StateWeave evals
  cli.ts     interactive inspection CLI
```

Docs live in a separate repository:

```txt
https://github.com/stateweave/docs
https://stateweave.dev
```

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm eval
pnpm cli
```

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). PRs should be small, include tests when behavior changes, and preserve the core primitive:

```txt
GraphFrame -> GraphOps -> StateGraph
```

## Security

Do not commit `.env`, provider keys, trace JSON with private prompts, or production data. See [`SECURITY.md`](./SECURITY.md).

## License

MIT
