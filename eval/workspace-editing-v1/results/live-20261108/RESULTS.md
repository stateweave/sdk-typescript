# Workspace editing v1 — GLM live result

## Verdict

**No valid paired estimate.** Zero of five cases completed in both arms, so this run cannot support a GraphFrame-versus-Messages capability, quality, or superiority claim.

The persistent Messages arm completed and passed four cases. The GraphFrame arm had five protocol failures. Operational failures retain `grade: null`; they are not task failures.

## Frozen execution

- Run: `workspace-editing-v1-glm-live-20261108-20261108T180028656Z`
- Source: `f560c2bb1ee8edcad7a946fa77c56e3b23ff8a0e`
- Provider/endpoint/model: `zai` / `api.z.ai/api/anthropic` / `glm-5.3-flash`
- Billing: approved Z.ai coding plan; incremental dollar estimate is unavailable and recorded as `null`
- Window: `2026-11-08T18:00:28.656Z`–`2026-11-08T18:27:54.404Z`
- Raw result SHA-256: `d04c5168bc1fd2333e72bdf1fe52ea679e4a82da842995d42e21ebedae48fb30`
- Preserved ten-workspace archive SHA-256: `5f096366d7e601a58ce8fc1609735cc6dea9272b93e3016d4aa37cb36e0a0a6f`
- Retries: zero
- Calls: 108 / 240
- Reserved tokens: 658,477 / 5,000,000
- Known tokens: 207,947 input + 98,886 output = 306,833
- Exact served identity: all 108 calls reported `zai` and `glm-5.3-flash`

## Outcomes

| Case | Order | GraphFrame | Persistent Messages |
|---|---|---|---|
| SDKWS-01 | Graph → Messages | Protocol failure on turn 2; 13 calls | Task pass; 15 calls |
| SDKWS-02 | Messages → Graph | Protocol failure on turn 2; 6 calls | Task pass; 12 calls |
| SDKWS-03 | Graph → Messages | Protocol failure on turn 4; 6 calls | Task pass; 12 calls |
| SDKWS-04 | Messages → Graph | Protocol failure on turn 1; 4 calls | Protocol failure; exhausted 12 iterations |
| SDKWS-05 | Graph → Messages | Protocol failure on turn 1; 4 calls | Task pass; 24 calls |

### GraphFrame failure pattern

The Graph arm made 33 calls and recorded 192,392 known tokens. Twenty-eight calls ended normally and produced accepted SWX actions. One call per case then reached the 4,096-output-token ceiling (`max_tokens`) without yielding accepted SWX text. The strict preflight rejected the malformed exchange without repair or workspace mutation. All five episodes therefore remained operational failures with `grade: null`.

### Messages failure pattern

The Messages arm made 75 calls and recorded 114,441 known tokens. Four episodes completed and passed deterministic grading. SDKWS-04 exhausted the 12-iteration ceiling on turn 1 after five colon-prefixed malformed action envelopes and seven unsuccessful file reads; it remained an operational failure with `grade: null`.

## Pre-execution evidence

A first packaged process stopped before the evaluator module loaded because its validation dependency was not bundled. It made zero provider calls, created no evaluation workspace, and was preserved without reuse under `preexecution-01/`. The replacement package bundled the exact dependency and executed from a new path. This was a packaging correction, not a provider or episode retry.

## Interpretation boundary

This is one descriptive pass over five approved synthetic regression-derived cases. There are no complete pairs, no statistical estimate, no winner, and no authorization to retry or alter output ceilings after seeing this result. Any follow-up protocol or resource change is a new experiment requiring a separately frozen plan and explicit approval.
