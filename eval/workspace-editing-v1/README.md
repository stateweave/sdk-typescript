# Workspace editing v1 — grading draft

Status: the five inputs are approved. The deterministic grader is implemented for review, but its grading method is not yet approved. Review the actual offline control grades in [`GRADING-REVIEW.md`](./GRADING-REVIEW.md). There is no model runner, provider call, baseline, score, or hillclimb.

## Proposed primary grade

`taskOutcome` is Boolean per episode. It passes only when all applicable checks pass:

- the final workspace contains exactly the listed files;
- read-only files remain byte-for-byte unchanged;
- editable JSON has the exact required typed value, ignoring object-key order and insignificant formatting while rejecting duplicate keys;
- the SVG has the required semantic elements/properties, ignores attribute order/equivalent numeric spelling, rejects extra elements/attributes and unsafe active/external content;
- SDKWS-03 leaves its already-correct file byte-for-byte unchanged and returns the exact requested JSON value, including legitimate `false` and `null` values.

The grader reports `workspaceCorrect`, `answerCorrect`, `fileScope`, `readOnlyUnchanged`, and `artifactSafety` separately so an empty answer, a legitimate negative, a wrong workspace, and a safety/scope failure cannot collapse into the same zero. `answerCorrect` is `null` when no structured final answer is required.

The grader does not inspect private GraphFrame state or Messages history and does not require a particular tool sequence. Transcript checks may later enforce process safety, but they are not substitutes for the actual final files.

## Deliberately excluded from the quality grade

- model/provider serving errors, timeouts, truncation, and grader exceptions;
- native GraphOps versus Messages formatting differences;
- exact JSON whitespace/key order or XML attribute order;
- prose style when no structured final answer is requested;
- latency, token usage, retries, and tool-call counts.

A future runner must record those as separate operational/performance fields. It must never turn an infrastructure or grader failure into `taskOutcome: false`.

## Offline controls

Run:

```bash
node eval/workspace-editing-v1/grade-controls.mjs --output /tmp/workspace-editing-controls.json
```

The control pass uses no model or network. It requires all five reference workspaces to pass and explicit stale/type/no-answer/scope/read-only/unsafe/no-op/duplicate-key controls to fail for the intended reason.

`cases.json` contains expected states for the grader. A future model runner must materialize only `initialFiles`, common instructions, and turns into an isolated workspace; expected files, expected answers, other cases, and graders must not be available to either arm.
