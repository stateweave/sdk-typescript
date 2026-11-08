# Workspace editing v1: SW2 GraphFrame vs Messages, exact GLM-5.3

## Verdict

**No comparative winner.** This is one approved, descriptive, paired pass of the SW2 GraphFrame build (PRs #103 and #104) against the Messages arm. It ran on the exact Z.ai model `glm-5.3`, with the same cases, limits and arm order as the baseline `glm53-live-20261108`.

- Graph completed and passed **2 / 5** cases. The baseline completed and passed 1 / 5.
- Messages passed **4 / 5** cases, the same as the baseline. This time its miss was a protocol failure rather than a graded task failure.
- **2 / 5** pairs are complete and endpoint-matched. Both arms passed both of those pairs.
- Graph used **85,737** known tokens. The baseline used 231,763, which is 63% less.
- Graph still has **3** protocol failures, all at the strict SW2 output gate. The evidence-gate failure from the baseline (`SDKWS-02`, editing without current evidence) did not recur.

One pass with two complete pairs supports no capability, quality or superiority claim.

## Frozen runtime

- Run ID: `workspace-editing-v1-glm53-sw2-live-20261108-20261108T221306984Z`
- Protocol: `workspace-editing-v1-glm53-sw2-live-20261108`
- Window: `2026-11-08T22:13:06.984Z`–`2026-11-08T22:23:27.729Z`
- Source revision: `e567d626b48a9a0a2559a1f311b906912a941f91`
- Provider / model: Z.ai / `glm-5.3` (109 of 109 provider responses reported exact identity `glm-5.3`; no `glm-5.3-flash` reference)
- Endpoint: `api.z.ai/api/anthropic`
- Limits match the baseline:
  - temperature `0`
  - `4,096` output tokens per call
  - `64,000` prompt-estimate tokens per call
  - `12` calls per turn
  - `0` retries
- Arm order: alternating by case
- Graph workers: disabled
- Billing: existing Z.ai coding-plan access; no per-token dollar estimate

The raw result, package receipt and workspace archive contain no credential material.

## Outcome

| Arm | Attempted | Completed | Task passes | Task failures | Protocol failures | Provider calls | Known tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| GraphFrame (SW2) | 5 | 2 | 2 | 0 | 3 | 35 | 85,737 |
| Messages | 5 | 4 | 4 | 0 | 1 | 74 | 111,908 |

### Against the baseline (`glm53-live-20261108`, SWX/1 GraphFrame)

| Arm | Passes: baseline → SW2 | Protocol failures | Provider calls | Known tokens |
|---|---|---|---|---|
| GraphFrame | 1 → 2 | 4 → 3 | 42 → 35 | 231,763 → 85,737 (−63.0%) |
| Messages | 4 → 4 | 0 → 1 | 72 → 74 | 122,414 → 111,908 |

Messages' code and prompt did not change between the runs. Its variance (`SDKWS-04` went from a task failure to a protocol failure) shows how noisy single passes are on this model.

## Case receipts

| Case | GraphFrame (SW2) | Messages | Pair |
|---|---|---|---|
| `SDKWS-01` | Task pass, 17 calls | Task pass, 13 calls | Complete, matched |
| `SDKWS-02` | Protocol failure on turn 3, 8 calls | Task pass, 20 calls | Incomplete |
| `SDKWS-03` | Task pass, 7 calls | Task pass, 10 calls | Complete, matched |
| `SDKWS-04` | Protocol failure on turn 1, 2 calls | Protocol failure on turn 1, 12 calls | Incomplete |
| `SDKWS-05` | Protocol failure on turn 1, 1 call | Task pass, 19 calls | Incomplete |

## Failure analysis

Each Graph failure has a different cause, and each was rejected by the no-repair SW2 gate.

- **`SDKWS-02`, fenced output.** On turn 3 the model produced a well-formed SW2 `edit_file` operation: it had the correct `expected_hash` from a prior read, and the old/new heredocs were valid. But it wrapped the whole frame in a code fence. This was the turn where the baseline failed the evidence gate; this time the model had read the file first.
- **`SDKWS-04`, output ceiling.** The second call hit `max_tokens` (`4,096` output tokens) with an empty visible response. The model spent the whole budget on hidden reasoning, so the gate had nothing to accept.
- **`SDKWS-05`, missing header.** The model returned a valid op line (`T read_file path=assets/catalog.json`) without the leading `SW2` header line.

Messages `SDKWS-04` used all 12 iterations on turn 1. It kept prefixing its actions with `🔎 ` (rejected as invalid), then cycled through reading files that don't exist (`README.md`, `index.html`, `data.json`, `layout.svg`).

Two of the three Graph failures are format-only: a fence, and a missing header line. A tolerant envelope parser would have accepted those frames, but the frozen protocol deliberately rejects them without repair. Any change there needs a new frozen protocol and approval before it can be measured.

## Accounting and evidence

- Calls: `109 / 240`
- Conservative reserved tokens: `596,116 / 5,000,000`
- Known input tokens: `157,023`
- Known output tokens: `40,622`
- Known total tokens: `197,645`
- Arm token split uses the baseline's method: Messages is summed from per-call usage, and GraphFrame is the run total minus Messages. Recomputed this way, the baseline gives its published `231,763 / 122,414` exactly.
- Raw result SHA-256: `7e7258bf61b517b00094c0ac694f59aa23a3d8756f23ec48f9907853881dea41`
- Workspace archive SHA-256: `63f14148ef66c356978494c2a901190fe29d765149b4c006032fc90a4a8abca3`
- Package receipt SHA-256: `f6cb894b6a4215710936dcbeea2119303a0e3b542716810f40f8019e5b9dcec0`
- Frozen manifest SHA-256: `148a90104f99a213b271662554c0d08c18e6b9484fde9abd2cad23610911dade`
- Archived workspaces: `10`

Raw transcripts and complete workspaces remain private evaluation evidence. This is a development result only: no UAT or production promotion, and no npm publish.
