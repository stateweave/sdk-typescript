# Workspace editing v1 — runner review

Status: provider-neutral runner core implemented and verified offline. No provider adapter, credential use, network request, paid execution, baseline, or result exists.

## Arms

### Direct GraphFrame

`runGraphEpisode` calls the real `runStateWeave` entry point for every user turn and carries the returned `GraphFrame` into the next turn. It uses the production SWX parser, GraphOps validation/application, scoped filesystem tools, and full runtime traces. It does not use the public `Agent` wrapper.

### Persistent Messages

`runMessagesEpisode` maintains one ordinary user/assistant message list for the whole episode. Every previous user turn, assistant action, tool result, protocol error, and final answer remains in the next request. This eval-only interface is not exported as a StateWeave primitive.

The control action protocol is explicit:

- `TOOL_CALL {"name":"...","args":{...}}` for one tool action;
- a user-role `TOOL_RESULT` containing the exact tool result;
- `FINAL_ANSWER:` followed by the literal answer, including a raw JSON answer when requested.

## Matched conditions already enforced

- the same approved common instructions at provider-system priority and the same turns supplied one at a time; Graph also serializes those instructions as its persistent graph system node;
- fresh isolated workspaces materialized only from `initialFiles` beneath a unique OS-temporary root created by `createEvaluationRoot`; arbitrary caller paths are rejected before recursive reset;
- the same scoped `read_file`, `write_file`, and `edit_file` implementations;
- caller-required matched ceilings for model calls per turn and full provider-request prompt tokens, including system instructions; the offline controls use 12 calls and 64,000 estimated prompt tokens, but no live ceiling is approved;
- no shell, worker spawning, host-file, credential, opposite-arm, grader, expected-state, future-turn, or other-case access through tools or model requests; valid `spawn_worker` output is rejected before the runtime can dispatch extra calls;
- no client-side output repair or hidden workspace correction;
- grading only after the final turn, against actual files and the final requested answer.

## Recorded evidence

The Graph arm records every model input, full-request prompt-token estimate, streamed text, raw provider metadata event, served provider/model, stop reason, latency, StateWeave trace, final frame, and grade. The Messages arm records every full request history, full-request prompt-token estimate, model text, served provider/model, stop reason, provider usage when supplied, latency, parsed action, tool result, final transcript, and grade. Total episode wall time is also recorded. `assertMatchedEndpoint` rejects a completed pair unless every recorded call matches the separately approved provider and model.

`captureEpisode` keeps task quality separate from operations. Model, protocol, runtime, grader, and abort failures return `grade: null` plus the requests, responses, tool results, Graph calls/traces, and last frame available at failure; they are never converted into `taskOutcome: false`. Failed workspaces are preserved as evidence rather than rolled back and must never be reused as another arm or attempt; a new attempt starts by materializing a new disposable child workspace.

## Intrinsic asymmetries to disclose

- Graph uses GraphFrame/GraphOps/SWX and StateWeave runtime validation; Messages uses a full transcript plus the text action envelope above.
- Graph provider calls are streamed through the SDK `Model` interface; Messages provider calls use an eval-only full-history interface.
- Protocol-error feedback is native GraphFrame error state in one arm and an explicit user-role `PROTOCOL_ERROR` message in the other. The eval transport preflight requires Graph output to begin with an exact `SWX/1` header and rejects fences, prefixes, legacy JSON, and workers before the production parser; the Messages action parser is likewise strict. Neither arm receives runner-level output repair.
- Graph serializes the common instructions into its persistent system node in addition to provider-system delivery; Messages retains them once as its provider system. Prompt/state size and protocol overhead are measured outcomes, not assumed equal.

A provider adapter must map both interfaces to the exact same provider, served model, decoding parameters, output-token ceiling, timeout, and retry policy. The low-level arm functions do not constitute a live orchestrator; any future orchestrator must call `assertMatchedEndpoint`, use one approved limits object for both arms, and apply the separately approved arm-order/fatal-failure policy. Those choices remain unapproved.

## Offline controls

`tests/workspaceEditingRunner.test.ts` currently proves:

1. both arms complete the same four-turn repeated-identity JSON edit, report the same expected provider/model, and pass the approved grader;
2. GraphFrame retains all four user turns while Messages sends the full prior history on every call;
3. the file-only `workspaceLabel` is absent before a read and appears only after tool evidence;
4. the legitimate no-op remains byte-identical and preserves exact `false`/`null` answer values;
5. nested/same workspaces are rejected;
6. mock serving, worker-spawn, legacy/prefixed or malformed Graph exchange, malformed Messages action, and pre-dispatch prompt-ceiling failures produce operational records with `grade: null`.

Verification:

```bash
npm run typecheck
npx vitest run tests/workspaceEditingRunner.test.ts tests/workspaceEditingGrader.test.ts
```

## Still blocked on separate approval

- provider and exact served model;
- provider-specific full-Messages adapter;
- per-request and per-episode token ceilings;
- timeout, retry, repetition, and stopping rules;
- price/accounting source and dollar ceiling;
- execution authority for any provider request;
- any expanded cohort, split, statistics, or hillclimb.
