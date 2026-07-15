# StateWeave SDK Hardening Plan

## Objective

Make the public StateWeave SDK safe for long-running, persistent agents by enforcing bounded model input, transactional SWX parsing, deterministic graph identity, and atomic persistent-agent state. Keep `GraphFrame -> GraphOps -> StateGraph` as the primitive and keep the graph append-only; only the model-facing projection is bounded.

## Scope and success criteria

### 1. Token-bounded model projection

Implementation:

- Add an explicit model-input token budget to `serializeGraphFrame` and the agent runner.
- Recursively summarize node metadata rather than serializing nested tool payloads wholesale.
- Prioritize mandatory frame state, active input, current focus, recent tool evidence, retrieved nodes, and semantic map entries.
- Stop adding optional projection lines before the configured budget is exceeded.
- Reject a call before invoking the provider if mandatory state alone cannot fit.
- Expose the effective prompt budget in run metadata.

Tests:

- A graph containing multi-megabyte nested `tool_result.data.result.content/stdout` remains below the configured prompt budget.
- The active user input, focus node, and concise tool-result evidence remain visible.
- A too-small budget fails locally and proves the model was never called.
- Every prompt emitted by a multi-step agent run stays within budget.

Success:

- No provider call receives more than the configured StateWeave prompt budget.
- The current dev trajectory graph serializes below that budget without retaining raw historical tool payloads.

### 2. Strict SWX transactions

Implementation:

- Reject unknown `@` commands.
- Reject unterminated raw blocks.
- Require exactly one final operation when finalizing and reject multiple finals.
- Reject duplicate node declarations and duplicate worker ids in one transaction.
- Preserve structured, retryable parser errors.

Tests:

- Typos such as `@ndoe` fail.
- Unterminated write/artifact/final blocks fail without executing a tool.
- Multiple finals fail.
- Duplicate node and worker identifiers fail.
- Valid SWX, multiline blocks, tools, workers, and final references continue to parse.

Success:

- Truncated or ambiguous model output cannot mutate the workspace or graph.

### 3. Correct zoom semantics

Implementation:

- Make higher `@zoom` values widen the projected radius/budget.
- Keep an independent hard token ceiling.
- Align prompt wording, tests, and implementation.

Tests:

- Higher zoom includes at least as much eligible graph context as lower zoom.
- Higher zoom still respects the prompt token budget.

Success:

- `@zoom 0` is tight and increasing zoom widens the view as documented.

### 4. Atomic persistent-agent state

Implementation:

- Serialize stateful `Agent.run/stream` calls; explicit-frame calls remain independent.
- Commit an input and result only after successful completion.
- Do not retain failed or aborted pending inputs.
- Make `resetFrame` invalidate any in-flight stateful commit.
- Ensure stream cancellation releases the state lock.

Tests:

- A failed run leaves the prior frame byte-identical.
- Concurrent stateful calls complete in invocation order and the second sees the first committed result.
- Reset during a run prevents the stale result from overwriting the reset.
- Aborted/closed streams do not deadlock later runs.

Success:

- Persistent state contains only committed turns and cannot be overwritten by stale work.

### 5. Graph identity integrity

Implementation:

- Allocate sequence ids from the maximum occupied suffix and verify uniqueness.
- Reject duplicate `add_node` ids against both the existing graph and the current transaction.
- Validate imported/reset frames before use: unique node/edge ids, valid edge endpoints, and valid focus references.

Tests:

- Gapped imported ids allocate the next unused suffix.
- Existing-node collisions and duplicate declarations fail transactionally.
- Invalid imported graphs fail before a provider call.

Success:

- Every graph node and edge has a stable unique identity and every edge endpoint exists.

### 6. Deterministic semantic overview

Implementation:

- Replace count-only cluster summaries with bounded deterministic semantic samples.
- Include compact overview pages for clusters that cannot fit individually.
- Keep stable ids and deterministic ordering.

Tests:

- Cluster summaries contain representative semantic content, not only counts.
- Repeated serialization is byte-identical for the same graph.
- Large graphs expose deterministic overview pages and explicit omitted ranges within budget.

Success:

- The model receives a useful bounded map of the whole graph and can identify where omitted regions live.

### 7. Public package hygiene

Implementation:

- Exclude eval and web-server artifacts from the npm tarball while retaining them in repository/deployment builds.
- Add a package-content verification script/test.

Tests:

- `npm pack --dry-run --json` contains public SDK/runtime files.
- It contains no `dist/evals/**`, `dist/web/**`, private scenario data, or traces.

Success:

- Published `stateweave` is a focused low-level SDK package.

## Verification gates

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm build`
4. `pnpm web:check`
5. `pnpm web:build`
6. `npm pack --dry-run --json` package-content assertion
7. Live-graph serialization measurement against the configured prompt budget
8. Pull-request CI passes

## Deployment safety

These changes alter the agent runtime used by the frozen Infinite trajectory. Before deploying development:

1. Confirm the trajectory is stopped.
2. Archive the complete mounted `infinite-agent` state under `/root/stateweave-infinite-archives` on Eve.
3. Record archive hashes and current protocol/corpus identity.
4. Bump the protocol version for the changed runtime.
5. Reset only the mounted `infinite-agent` directory while stopped; preserve unrelated `/data` state.
6. Deploy the development compose.
7. Confirm the service is healthy and remains stopped.
8. Verify the SDK lab and prompt-budget behavior without starting a held-out trajectory.
