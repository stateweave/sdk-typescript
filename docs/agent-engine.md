# StateWeave agent engine

StateWeave stores no provider `messages[]` and does not ask the model to author graph mutations. Ordinary execution grows an immutable causal graph; a bounded compiler renders the temporary token sequence required for each inference.

This is the engine behind the public `Agent` class.

## Primitive

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

Node identity is SHA-256 over kind, sorted parent ids, payload, and optional resource key. Timestamps and insertion sequence are metadata, not identity.

The defining invariant is:

> A model action's parents are exactly the graph nodes selected for that inference.

The runtime already knows the compiled read set, so lineage requires no extra model syntax or model call.

## Execution

1. Append the system contract and user goal.
2. Compile a bounded causally connected set from the frontier, current resource heads, recent evidence, relevant older nodes, and a deterministic whole-graph digest.
3. Invoke the model with the normal `TOOL_CALL` / `FINAL` protocol.
4. Append the action with the compiled node ids as parents.
5. Execute the requested tool.
6. Append the typed tool result as a child of the call.
7. Append content-addressed resource-version nodes for observed or changed paths.
8. Repeat until an answer is accepted or a configured limit stops the run.

Failed work remains available in diagnostic error state. A public `Agent` commits only successful runs to its owned state. Superseded resource versions remain addressable while current resource heads receive projection priority.

## Compiler

The compiler does not reconstruct a chat transcript. It serializes typed graph nodes with parent ids and frontier markers.

Selection combines:

- system and goal roots;
- current frontier;
- a deterministic whole-graph digest of current resources, activity counts, recent mutations, and recent recorded inference notes;
- current resource heads;
- a recent evidence window;
- bounded operational closure (`resource → result → call`, `protocol_error → inference`);
- lexical relevance, recency, and evidence authority.

Equivalent repeated reads, calls, results, protocol errors, and superseded resource details collapse to their latest projection representative. Resource ancestry remains intact in storage but does not recursively pull every obsolete version into the working context.

Inference nodes keep their complete read sets as provenance, but the compiler does not recursively expand those provenance parents. Doing so would reintroduce full linear-history cost through transitive closure. Provenance remains queryable in storage while operational evidence receives automatic projection closure.

The full graph remains lossless. The compiler targets `projectionTargetTokens` while independently enforcing `maxPromptTokens`. Optional nodes are removed toward the target; mandatory causal state may exceed the target but may not exceed the hard ceiling.

## Public API

There is one public class:

```ts
const agent = new Agent({ model, state });
const result = await agent.run("Continue the task");
```

`result.state` is the lossless state. `result.graph` and `agent.getGraph()` are visualization views. `AgentState` can be exported and imported; identity, parent ordering, sequence, and frontier references are validated on import.

## Tool parity

The agent uses ordinary tool schemas and executors. It adds no memory tool and no graph-only action. The model may choose a different action sequence because its state differs; its capabilities do not.

## Current limitations

- Black-box providers still receive a linear token rendering; StateWeave does not claim arbitrary transformer KV-cache composition.
- Relevance is causal, lexical, and recency-based. Semantic indexes may be added as secondary indexes without changing graph truth.
- Bounded rendering can omit part of an old large payload even though the immutable source node remains stored.
- The digest is deterministic rather than a learned semantic summary; recent model notes quote recorded inference nodes and can preserve a stale plan until newer reasoning supersedes it.
- Resource extraction currently relies on generic tool path/hash/mutation metadata.

## Origin and evidence

This engine was developed and tested as Causal Weave Variant C in the frozen one-shot SDK benchmark. It materially outperformed the other preserved artifacts in browser review, while still exhibiting a packaging defect. Promotion into `Agent` therefore preserves the benchmark evidence but does not claim that one benchmark proves universal superiority. Continued paired evaluation is required.
