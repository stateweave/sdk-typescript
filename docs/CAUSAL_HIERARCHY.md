# Causal hierarchy

StateWeave keeps one immutable causal source graph and compiles a bounded hierarchical view over it. The hierarchy is a view, not another state store.

```text
source atoms
  -> deterministic turn/entity leaves
  -> topic timelines or explicit entity topics
  -> session map
```

## Invariants

- Source node identities, payloads, parents, frontier, and successful-run commit rules are unchanged.
- A topic or leaf stores source IDs and labels only; it never replaces or owns source truth.
- Model read-set lineage contains only the visible source node IDs, never hidden nodes represented by a topic line.
- Membership is deterministic: explicit file/entity/semantic keys first, then bounded chronological windows.
- Query retrieval is lexical and structural. Generic instruction words do not pull unrelated old answers into focus, and generic semantic types do not count as evidence.
- `projectionMaxNodes` is a hard visible-source-node ceiling. Resource heads are selected only when query-relevant, directly attached to the current answer, or needed as the latest file evidence; all other resource state remains in bounded indexes.

## Compilation

Every prompt has an explicit `<CURRENT_TASK>` block. Molecular prompts additionally contain:

- `<SESSION_MAP>`: a bounded session-level map of topics and child leaves;
- `<MAP>`: selected molecule shells and cross-molecule ports;
- `<EXPANDED>`: the exact source atoms selected for this call.

The compiler prioritizes the current system/goal/frontier, relevant resource evidence, exact query matches, and the latest continuity answer. It then fills remaining slots by deterministic relevance and recency. Operational parents of selected resource/tool evidence are admitted only while the hard node budget permits.

## Visual graph

The browser projects the same topic and leaf hierarchy over the complete consumer-safe graph:

- **Focused** is the default. It renders at most the configured focus atoms, focused subgraphs, recent topic summaries, and one bounded archive summary for older topics.
- A topic summary expands into child subgraphs. A subgraph summary expands into its immutable source atoms.
- Cross-boundary edges are rerouted, merged by rendered endpoints, and limited to four deterministic incoming visual edges per rendered node. Each visual edge retains its exact source-edge count and source-edge types.
- Every synthetic visual node carries the exact source member IDs and source count. It owns no payload, state, or causal authority.
- Older topics and older subgraphs are grouped behind bounded archive nodes so the default SVG does not grow linearly with the source graph.
- **All topics** reveals every topic summary while keeping source atoms bounded. Any topic and subgraph can then be expanded locally to its complete source atoms. Switching views never mutates state.

The model context and browser focus use the same deterministic hierarchy and node target. During a live run the graph receives the latest compiled read-set as its preferred focus; restored sessions deterministically reconstruct focus from the current goal, frontier, projection, and timeline.

## Lab surface

The development lab keeps the product question visible: can graph memory outlast appended messages without context bloat? Every session runs StateWeave and traditional messages in parallel. The two arm controls show each latest final-call context, while the evidence pane exposes only Graph, Context, Files, and Tools. Sessions, long-run playback, settings, import/export, and historical experiments remain available through compact disclosures instead of occupying the workspace. On narrow screens, Chat and Memory are separate explicit panes.

The canonical graph is never compacted. A future persisted summary layer may add versioned summaries with explicit coverage IDs, but those summaries must remain derived evidence and must be rebuilt when covered source nodes change.
