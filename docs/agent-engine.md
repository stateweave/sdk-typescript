# StateWeave agent engine

StateWeave stores no provider `messages[]` and does not ask the model to author graph mutations. Ordinary execution grows an immutable causal graph; a bounded compiler renders the temporary token sequence required for each inference.

This is the engine behind the public `Agent` class.

## Primitive

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

Node identity is SHA-256 over kind, sorted parent ids, payload, and optional resource key. Timestamps and insertion sequence are metadata, not identity.

The defining invariant is:

> A model action's parents are exactly the graph nodes selected for that inference.

The runtime already knows the compiled read set, so lineage requires no extra model syntax or model call.

## Execution

1. Append the system contract and user goal.
2. Compile a bounded causally connected set from the frontier, current resource heads, recent evidence, relevant older nodes, and a deterministic whole-graph digest.
3. Invoke the model with the normal `TOOL_CALL` / `FINAL` protocol. `streamEvents()` uses the model's streaming interface and forwards provider tokens and metadata while the action is being collected.
4. Append the action with the compiled node ids as parents.
5. Execute the requested tool.
6. Append the typed tool result as a child of the call.
7. Append content-addressed resource-version nodes for observed or changed paths and recognized `verification` nodes for successful post-mutation reads, syntax checks, or explicit application checks.
8. Repeat until an answer is accepted or a configured limit stops the run.

Failed work remains available in diagnostic error state. A public `Agent` commits only successful runs to its owned state. Superseded resource versions remain addressable while current resource heads receive projection priority.

## Compiler

The compiler does not reconstruct a chat transcript. It serializes typed graph nodes with parent ids and frontier markers.

Selection combines:

- system and goal roots;
- current frontier;
- a deterministic whole-graph digest of current resources, activity counts, recent mutations, and recent recorded inference notes;
- current resource and semantic heads;
- a deterministic multi-resolution overview of topic clusters, neighboring summaries, focus detail, and recent timeline;
- a recent evidence window;
- bounded operational closure (`resource → result → call`, `verification → result`, `protocol_error → inference`);
- lexical relevance, recency, and evidence authority.

Equivalent repeated reads, calls, results, protocol errors, and superseded resource details collapse to their latest projection representative. Resource ancestry remains intact in storage but does not recursively pull every obsolete version into the working context.

Inference nodes keep their complete read sets as provenance, but the compiler does not recursively expand those provenance parents. Doing so would reintroduce full linear-history cost through transitive closure. Provenance remains queryable in storage while operational evidence receives automatic projection closure.

The full graph remains lossless. The compiler targets `projectionTargetTokens` while independently enforcing `maxPromptTokens`. Optional nodes and payload detail are reduced toward the target; mandatory causal state may exceed the target but may not exceed the hard ceiling. If the mandatory view cannot fit, compilation fails before the provider is called. The budget is an explicit character-based estimate, so it is a safety ceiling rather than a claim about a provider's exact tokenizer.

### Molecular context

`contextMode: "molecular"` changes only the disposable model-facing view. Deterministic turn/entity clusters become outer `MOLECULE` nodes, selected source nodes appear in `EXPANDED` blocks, and causal edges crossing cluster boundaries become `PORT` records. The source `AgentState`, content-addressed node identity, exact compiled read-set parents, validation, tool execution, and success-only commit rules remain unchanged.

`projectionMaxNodes` independently targets optional detailed source atoms; mandatory frontier, current resource, and exact query matches may exceed it. The development lab uses molecular mode with a 16-node optional-detail target; the public SDK keeps causal mode and 48 atoms as compatibility defaults. Graph views expose deterministic molecule id, label, and sequence metadata so consumers can render expandable subgraphs without making those views authoritative.

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
- Relevance and clustering are deterministic, causal, lexical, and recency-based. There is no embedding index or learned semantic summary.
- The public `Agent` exposes molecular metadata but not a prescribed UI; the development lab provides the reference expand/collapse interaction.
- Bounded rendering can omit part of an old large payload even though the immutable source node remains stored.
- The digest is deterministic rather than a learned semantic summary; recent model notes quote recorded inference nodes and can preserve a stale plan until newer reasoning supersedes it.
- `verification` nodes are emitted for recognized successful evidence patterns, not for every arbitrary domain-specific check. A successful custom tool result may set `verification: true` to record a generic signal; product policy should still decide whether its structured evidence is sufficient.
- Resource extraction currently relies on generic tool path/hash/mutation metadata.

## Origin and evidence

This engine was developed and tested as Causal Weave Variant C in the frozen one-shot SDK benchmark. It materially outperformed the other preserved artifacts in browser review; the preserved artifact had a packaging defect, while the promoted package has an independent package-content check. Promotion into `Agent` preserves the benchmark evidence but does not claim that one benchmark proves universal superiority. Continued paired evaluation is required.
