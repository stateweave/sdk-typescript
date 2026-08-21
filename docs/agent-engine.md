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

## Development lab paired sessions

The primary development chat sends every user input to two arms concurrently. The StateWeave arm runs the public `Agent` with molecular projection. The traditional arm runs ordinary persistent `messages[]`. Both use the same provider, user input, operational system prompt, tool definitions, iteration limit, and 64K hard prompt ceiling. Their filesystem roots are isolated: `STATEWEAVE_WORKSPACE_DIR` and `STATEWEAVE_TRADITIONAL_WORKSPACE_DIR`. A new paired session copies the current StateWeave workspace into the traditional root once, then each arm evolves independently.

Traditional context preflight compacts before a turn would cross an estimated 30K tokens. The model summarizes the older committed transcript as data, preserving concrete files, facts, decisions, constraints, corrections, failures, and unresolved work; the active transcript becomes the system message, compacted summary, and latest six messages before the new user input is appended. A suspiciously short or protocol-shaped summary is rejected and retried once. Compaction input/output/model calls are included in that turn's traditional usage, while attempted and committed compactions are reported separately. Successful preflight maintenance is hash-validated and retained even if the subsequent task fails; failed-turn user/tool content still does not advance memory. The append-only log retains every original user input and final arm outcome.

Authoritative paired sessions live under `STATEWEAVE_DUAL_SESSION_DIR` (Docker default `/data/dual-sessions`). The browser retains only a random 128-bit paired-session id and its display preference. Each `paired_turn` JSONL record atomically stores both arm outcomes on one turn axis. A successful StateWeave arm stores only new causal nodes and its frontier; a successful traditional arm stores its bounded active transcript. A failed arm records its error and measurable usage without advancing task memory, while the other arm may commit successfully. Traditional failed outcomes may additionally carry only the validated preflight maintenance snapshot of previously committed history. Every 50 turns adds a validated checkpoint for both memory primitives.

Replay validates entry lineage, turn sequence, causal state, state hashes, transcript hashes, and checkpoints. A final unterminated tail is repaired before append, malformed complete records fail closed, file locks serialize commits, and expected-parent comparison rejects stale tabs. A private/no-store `GET /api/dual/sessions` returns bounded recent summaries for the ChatGPT-style session picker; `GET /api/dual/sessions/:id` restores a selected paired log. New chat preserves the previous JSONL session instead of deleting it, and a device without a stored id opens the most recently updated saved session. Right-clicking or keyboard-opening a session exposes a confirmed permanent Delete conversation action; `DELETE /api/dual/sessions/:id` removes the paired JSONL record containing both StateWeave and Traditional histories. The current development lab is single-user and has no account authentication; production multi-user deployment must add authorization before exposing session summaries. The original `STATEWEAVE_SESSION_DIR` single-arm store and endpoints remain available for compatibility and diagnostics; the primary chat does not modify them. Per-run files under `STATEWEAVE_TRACE_DIR` remain separate diagnostic traces rather than recovery state.

The Token usage workspace plots both arms on the same turn axis: summed input, output, peak single-call context, cumulative totals, tool/model calls, provenance, and traditional compaction cost. The arm switch changes only which response, active memory view, model loop, and isolated filesystem the UI displays. It never changes execution: every submitted input runs both arms.

### Long-horizon director

The session picker includes one Play/Pause control for an unlimited browser-owned long-horizon loop. `POST /api/dual/director` loads the selected paired session, gives one separate model call a bounded latest 40,000-character view of user inputs plus both arm answers, and requests one fresh standalone user task. The output is normalized, capped at 2,000 characters, rejected and retried once when it contains obvious conversation-dependent language, then sent unchanged through the ordinary paired-run endpoint. Director usage is separate from both comparison arms.

Play schedules another generated task after each successful pair; either-arm failure immediately pauses playback and clears the transient queue. Pause prevents the next generated task but never interrupts the pair already running. The composer remains available during a run. Manual messages enter a browser-local FIFO and always run before a generated prompt waiting for dispatch. Switching/resetting sessions stops playback and clears that transient queue. Refresh also returns playback to Paused; committed paired turns remain authoritative in JSONL.

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
