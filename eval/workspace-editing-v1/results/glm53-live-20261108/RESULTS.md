# Workspace editing v1 — exact GLM-5.3 result

## Verdict

**No comparative winner.** This corrected run used the intended non-Flash Z.ai model `glm-5.3` on all 114 provider calls. Only one of five cases completed in both arms; both arms passed that case. One complete pair is insufficient for a capability, quality, or superiority estimate.

The earlier `glm-5.3-flash` run remains preserved separately as wrong-model evidence and is not part of this result.

## Frozen runtime

- Run ID: `workspace-editing-v1-glm53-live-20261108-20261108T193143207Z`
- Window: `2026-11-08T19:31:43.207Z`–`2026-11-08T19:52:28.359Z`
- Source revision: `40a69c0a698442265c19399e7ef18c531f5aaec8`
- Provider / model: Z.ai / `glm-5.3`
- Endpoint: `api.z.ai/api/anthropic`
- Temperature: `0`
- Output ceiling: `4,096` tokens per call
- Prompt estimate ceiling: `64,000` tokens per call
- Iteration ceiling: `12` calls per turn
- Retries: `0`
- Arm order: alternating by case
- Billing: existing Z.ai coding-plan access; no per-token dollar estimate

Every provider response reported exact model identity `glm-5.3` and a stop reason. The raw evidence contains no credential marker and no `glm-5.3-flash` model reference.

## Outcome

| Arm | Attempted | Completed | Task passes | Task failures | Operational / protocol failures | Provider calls | Known tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| GraphFrame | 5 | 1 | 1 | 0 | 4 | 42 | 231,763 |
| Messages | 5 | 5 | 4 | 1 | 0 | 72 | 122,414 |

- Complete pairs: `1 / 5`
- Endpoint-matched complete pairs: `1 / 5`
- The sole complete pair was `SDKWS-03`; both arms passed.
- Messages failed `SDKWS-04` on the graded final workspace: `fixtures/cards.json` had the wrong JSON value.
- Graph ended four episodes as protocol failures. Three rejected responses that did not begin with the exact `SWX/1` header; one exhausted the GraphOps loop after attempting an edit without current file evidence.
- Operational failures retain `grade: null`; they are not counted as task failures.

## Case receipts

| Case | GraphFrame | Messages | Pair |
|---|---|---|---|
| `SDKWS-01` | Protocol failure on turn 2, 12 calls | Task pass, 13 calls | Incomplete |
| `SDKWS-02` | Protocol failure on turn 2, 16 calls | Task pass, 17 calls | Incomplete |
| `SDKWS-03` | Task pass, 8 calls | Task pass, 7 calls | Complete, matched |
| `SDKWS-04` | Protocol failure on turn 1, 5 calls | Task failure, 16 calls | Incomplete |
| `SDKWS-05` | Protocol failure on turn 1, 1 call | Task pass, 19 calls | Incomplete |

## Accounting and evidence

- Calls: `114 / 240`
- Conservative reserved tokens: `731,783 / 5,000,000`
- Known input tokens: `263,876`
- Known output tokens: `90,301`
- Known total tokens: `354,177`
- Raw result SHA-256: `3663e740fbe3b7e0dee3ea88b48a2f8ade32a733f15b5cf28dc933d550898d72`
- Workspace archive SHA-256: `40347c2127639db51da1247974d4584d1d1c67c64ea31c9501811cbf4270fccc`
- Frozen package SHA-256: `1fa420a323e3d9c789a8a7e98f3286994f98ad4d011bb9247438e0d275f83dc2`
- Archived workspaces: `10`

Raw transcripts and complete workspaces remain private evaluation evidence. The development portal contains only sanitized aggregate receipts.
