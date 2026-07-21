# Causal Weave (Variant C)

Causal Weave is an experimental graph-native StateWeave primitive. It does not store provider `messages[]` and does not ask the model to author GraphOps. Ordinary execution grows an immutable causal graph; a bounded compiler renders the active graph frontier into the temporary token sequence required for inference.

Variant C exists beside the current `StateGraph → GraphFrame → GraphOps` runtime. It is not yet the default SDK agent.

## Primitive

```ts
type CausalWeaveNode = {
  id: string;
  kind: "system" | "goal" | "inference" | "tool_call" | "tool_result" |
    "resource" | "verification" | "answer" | "protocol_error";
  parents: string[];
  payload: unknown;
  createdAt: string;
  sequence: number;
  resourceKey?: string;
};

type CausalWeaveSnapshot = {
  version: 1;
  nodes: CausalWeaveNode[];
  frontier: string[];
};
```

Node identity is SHA-256 over the node kind, sorted parent ids, payload, and optional resource key. Timestamps and insertion sequence are metadata, not identity.

The defining invariant is:

> A model action's parents are exactly the graph nodes selected for that inference.

The runtime already knows the compiled read set, so this lineage requires no extra model syntax or model call.

## Execution

1. Append the shared system contract and user goal.
2. Compile a bounded causally connected set from the active frontier, current resource heads, recent evidence, and relevant older nodes.
3. Invoke the model with that compiled graph and the normal `TOOL_CALL` / `FINAL` protocol.
4. Append the action with the compiled node ids as parents.
5. Execute the same shared tool object used by the transcript runner.
6. Append the typed tool result as a child of the call.
7. Append content-addressed resource-version nodes for observed or changed paths.
8. Repeat until an answer is accepted or a shared limit stops the run.

Failed work remains in the graph. Superseded resource versions remain addressable while current resource heads receive projection priority.

## Compiler

`CausalWeave.compile()` does not reconstruct a chat transcript. It serializes typed graph nodes in chronological order with parent ids and frontier markers.

Selection combines:

- mandatory system and goal roots;
- current frontier;
- a deterministic whole-graph digest of current resources, activity counts, recent mutations, and the latest substantive recorded inference notes;
- current resource heads;
- a short recent evidence window;
- bounded **operational** closure (`resource → result → call`, `protocol_error → inference`);
- generic lexical relevance, recency, and evidence authority.

Equivalent repeated reads, calls, results, protocol errors, and superseded resource details collapse to their latest projection representative. Resource-version ancestry remains intact in storage but does not recursively pull older versions into the operational closure. This prevents repeated inspection of one large file from consuming the projection while the whole-graph digest keeps peripheral work visible.

Inference/action nodes keep their complete read sets as provenance, but the compiler deliberately does not recursively expand those provenance parents. Doing so would reintroduce the full linear-history cost through transitive closure. Provenance remains queryable in storage while operational evidence alone receives automatic projection closure.

The full graph remains lossless. The compiler can target a smaller working projection than the provider's hard input ceiling; optional nodes are removed toward that target while mandatory causal state may exceed it, and the independent hard ceiling still applies. Per-node rendering and the final compiled view are bounded before inference.

## Tool parity

Variant C uses the same:

- tool array and schemas;
- tool descriptions and argument protocol;
- `executeAgentTool()` implementation;
- process timeouts and cleanup;
- workspace and OpenShell policy;
- provider model/system;
- canonical one-shot task.

Causal Weave adds no memory tool and no graph-only action. The model may choose a different action sequence because its state differs; its capabilities do not.

## Current limitations

- Black-box providers still receive a linear token rendering; Causal Weave does not claim arbitrary transformer KV-cache composition.
- Relevance is presently causal, lexical, and recency-based. Semantic indexes can be added as secondary indexes without changing graph truth.
- Bounded rendering can omit part of a large old payload even though the immutable source node remains stored.
- The digest is deterministic rather than a learned semantic summary; its recent model notes quote existing inference nodes and can therefore preserve a stale plan until newer reasoning supersedes it.
- Resource extraction currently relies on generic tool path/hash/mutation metadata.
- Variant C is one-shot and single-agent in the current benchmark. Multi-head concurrency and explicit merge policy remain future work.

## Benchmark operation

After an unscored completed A/B SDK-build run, Variant C can be launched through the lab or `POST /api/sdk-build/variant-c/start`. It receives a fresh sandbox and a fixed exploratory 3,000-iteration ceiling. A reviewed runtime correction may launch another attempt only through the root-owned request marker; prior C artifacts are preserved under attempt-specific keys. Original A/B artifacts, labels, scores, and metrics are untouched. The worker persists:

- `workspace/`;
- `output/result.json`;
- `output/weave.json` or `weave.failed.json`;
- periodic weave and metric checkpoints;
- preview root and efficiency metrics in benchmark state.
