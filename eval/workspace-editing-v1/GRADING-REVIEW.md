# Workspace editing v1 — grading review

**Decision requested: approve or revise this deterministic grading method.**

This is an offline grader demonstration over explicit reference and deliberately wrong snapshots. It contains no model output, provider request, baseline, or capability result. The five inputs are approved; the grader is not yet approved.

## Proposed rule

- Primary `taskOutcome` passes only when the actual final workspace, requested structured answer, file scope, read-only preservation, and SVG safety all pass.
- JSON is compared by typed value, ignoring key order/formatting and rejecting duplicate keys.
- SVG is compared semantically for the approved structure/properties, ignoring attribute order/equivalent numeric spelling and rejecting active/external content.
- SDKWS-03 is a legitimate no-op: the original bytes must remain unchanged, and its final answer must preserve `false`, `null`, and the file-only workspace label.
- No transcript or private graph state can substitute for the final files. A particular edit/tool path is not required.
- Serving errors, timeouts, truncation, grader exceptions, tokens, latency, retries, and native GraphOps/Messages formatting remain separate fields in a future runner.

Implementation: `eval/workspace-editing-v1/grader.mjs`  
Cases: `eval/workspace-editing-v1/cases.json`  
Method note: `eval/workspace-editing-v1/README.md`

## Actual offline control results — 14/14 matched

| Control | Expected | Outcome | Workspace | Answer | Scope | Read-only | SVG safe | Reason |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `SDKWS-01-oracle` | pass | pass | pass | n/a | pass | pass | pass | — |
| `SDKWS-01-stale-revisions` | fail | fail | fail | n/a | pass | pass | pass | assets/panel.svg: indicator width must be 36 |
| `SDKWS-02-oracle` | pass | pass | pass | n/a | pass | pass | pass | — |
| `SDKWS-02-string-false` | fail | fail | fail | n/a | pass | pass | pass | fixtures/viewer.json has the wrong JSON value |
| `SDKWS-03-oracle` | pass | pass | pass | pass | pass | pass | pass | — |
| `SDKWS-03-empty-answer` | fail | fail | pass | fail | pass | pass | pass | final answer is not one strict JSON object: unexpected JSON token at character 0 |
| `SDKWS-04-oracle` | pass | pass | pass | n/a | pass | pass | pass | — |
| `SDKWS-04-blanket-label-replacement` | fail | fail | fail | n/a | pass | pass | pass | fixtures/cards.json has the wrong JSON value |
| `SDKWS-05-oracle` | pass | pass | pass | n/a | pass | pass | pass | — |
| `SDKWS-05-stale-preview-selection` | fail | fail | fail | n/a | pass | pass | pass | docs/preview.json has the wrong JSON value |
| `SDKWS-02-extra-and-read-only-change` | fail | fail | pass | n/a | fail | fail | pass | file scope mismatch: expected fixtures/reference.json, fixtures/viewer.json; found extra.txt, fixtures/reference.json, fixtures/viewer.json<br>read-only file changed: fixtures/reference.json |
| `SDKWS-01-unsafe-event-handler` | fail | fail | fail | n/a | pass | pass | fail | assets/panel.svg is unsafe: event-handler attributes are forbidden<br>assets/panel.svg: svg root attributes must be exactly viewBox, xmlns |
| `SDKWS-03-needless-reformat` | fail | fail | fail | pass | pass | pass | pass | settings/manual.json must remain byte-for-byte unchanged |
| `SDKWS-02-duplicate-json-key` | fail | fail | fail | n/a | pass | pass | pass | fixtures/viewer.json is not strict JSON: duplicate object key "workspace" at character 42 |

## Important examples to inspect

1. **SDKWS-01 oracle:** valid revised SVG passes. The stale width/caption snapshot fails the actual SVG property check.
2. **SDKWS-02 string `"false"`:** fails even though it looks similar to Boolean `false`. Duplicate JSON keys also fail rather than silently taking the last value.
3. **SDKWS-03 oracle:** unchanged bytes plus the exact JSON answer passes with `changeNeeded:false` and `annotation:null`. Empty output fails only `answerCorrect`; a needless reformat fails only the workspace requirement even with a correct answer.
4. **SDKWS-04 blanket replacement:** fails because the right card must remain `Ready` while the selected left card becomes `Review`.
5. **SDKWS-05 stale preview:** fails because the two final JSON files disagree after the selection reversal.
6. **Scope/safety controls:** extra files, a modified read-only reference, and an SVG event handler fail distinct checks.

## Verification

```text
PASS: approved common instructions + 20 turns match cases.json
14/14 offline controls behaved as expected
59 retained parser/runner/tool tests passed
0 provider calls
```

Approval here covers this grading method for these five seeds and permits building the audited runner next. It does not approve a provider/model, paid pilot, baseline, expanded dataset, retries, or hillclimb.
