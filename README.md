# StateWeave TypeScript SDK

[![CI](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/ci.yml)
[![CodeQL](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml/badge.svg)](https://github.com/stateweave/sdk-typescript/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7c3aed.svg)](./LICENSE)

StateWeave is a low-level TypeScript SDK for building agents around graph state instead of chat transcripts.

```txt
GraphFrame -> model -> GraphOps -> StateGraph
```

The model is still a normal transformer. StateWeave changes the runtime primitive around it: the SDK serializes a structured graph frame, asks the model for validated operations, applies them to an in-memory graph, and exposes every state transition for inspection.

The current runtime uses a Cortex-style focus model: `system_root` anchors the graph, new user inputs enter as pending nodes, and `GraphFrame` carries `focusNodeId`, `activeUserInputNodeId`, and candidate focus points. The model then returns GraphOps edges deciding whether the input starts a new root-level branch, continues a prior node, updates an output, or relates elsewhere. Only runtime nodes are structural (`system`, `user_input`, `assistant_output`, `tool_call`, `tool_result`); all other node types are model-created semantic slugs.

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
- Cortex-style graph focus/branching over transcript replay.
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

## Quickstart

```ts
import { StateWeaveAgent, createModelFromEnv, mockTools } from "stateweave";

const agent = new StateWeaveAgent({
  model: createModelFromEnv(),
  tools: mockTools,
  maxSteps: 5
});

const result = await agent.run(
  "Find why login fails after token refresh. Login fails after refresh. Do not rewrite the auth system."
);

console.log(result.finalAnswer);
console.log(result.graph.nodes);
```

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
    for await (const event of this.stream(input)) text += event.token;
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
ANTHROPIC_MAX_TOKENS=1024
ANTHROPIC_TEMPERATURE=0
```

## Add tools

Tools are Zod-validated functions. Tool results are inserted back into the graph as `tool_result` nodes.

```ts
import { z } from "zod";
import type { Tool } from "stateweave";

const readFile: Tool = {
  name: "read_file",
  description: "Read a source file by path.",
  schema: z.object({ path: z.string() }),
  async execute(args) {
    const { path } = z.object({ path: z.string() }).parse(args);
    return `fake contents for ${path}`;
  }
};

const agent = new StateWeaveAgent({
  model,
  tools: [readFile],
  maxSteps: 5
});
```

The model can emit:

```json
{
  "op": "call_tool",
  "tool": "read_file",
  "args": { "path": "auth.ts" }
}
```

StateWeave validates the args, executes the tool, and carries the result into the next `GraphFrame`.

## Visualize graph state

State graphs can be rendered as Mermaid for Obsidian-style inspection.

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
