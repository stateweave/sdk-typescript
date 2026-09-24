# Jev quality checkpoints: a small retrieval signal, not a substantial SDK leap

**Decision:** do not promote source-grounding gates or the combined prototype into SDK defaults. Keep bounded gap recovery as a research candidate: it recovered one genuinely missing fact, but this pilot does not establish a broad answer-quality gain. Nothing from this experiment was deployed. The separate memory-equivalence experiment was not part of these treatments.

## Frozen experiment

Protocol, participants, private references, thresholds, scoring code, and implementation were committed at **`d68b6d16c5e01c2cb8a1ee8435b010e2524385c1` before evaluation provider calls**. See [PROTOCOL.md](PROTOCOL.md).

Thirty-two independently authored, public LongMemEval **oracle** cases span six question types plus eight abstentions. Their 53 source sessions do not overlap between cases; histories contain 6–36 turns. Original `answer_` session annotations were replaced with opaque hashes before freezing. This is evidence-only history, not the full S/M distractor-retrieval benchmark.

One question-blind GLM extraction proposed memories from each original dated history. The four arms shared that extraction and unchanged source records. Question answering used the real public `Agent`, GLM `glm-5.3-flash`, temperature 0, no tools, two iterations maximum, and the Lab's molecular/16-node setting under a 16K working target and 64K hard prompt limit. This is not the SDK's default causal/48-node configuration or an organic many-turn memory lifecycle.

Jev `jev-1.13.0` checked source support and, separately, context sufficiency followed by bounded missing-evidence nomination. Six nodes could be nominated without increasing context budgets. Rejected proposals remained explicitly unverified evidence; original records were never deleted.

An isolated `openai-codex/gpt-5.6-sol`/low judge scored anonymous, case-shuffled answers using an adapted official rubric. A separate packet audited proposed memories against original sources without seeing the future question or Jev scores. Six simple calibration decisions passed. These are model judgments, not human-certified labels or official leaderboard scores. Recall of earlier assistant advice also does not establish that the original advice was factually correct or safe.

## Answer results

| Arm | Correct / 32 planned cases | Correct / 30 complete cases | Wins / losses versus baseline on complete cases | Exact paired p |
|---|---:|---:|---:|---:|
| Baseline | 30/32 | 28/30 | — | — |
| Grounding only | 28/32 | 28/30 | 0 / 0 | 1.00 |
| Recovery only | 32/32 | 30/30 | 2 / 0 | 0.50 |
| Combined — primary | 31/32 | 29/30 | 1 / 0 | 1.00 |

All arms preserved **8/8 abstention correctness**. The preregistered primary gate—at least 30 eligible pairs, at least **20 percentage points** improvement, paired p < .05, and safety invariants—**failed**. Combined improved by one answer: 3.3 points in the complete-case comparison, or 3.125 points across all 32 baseline/combined pairs.

The frozen bootstrap gives a combined difference interval of 0–10 points. It is an empirical small-sample bootstrap, not proof of noninferiority; zero observed losses cannot represent unseen failure modes. With baseline already 30/32, this particular cohort had only 6.25 points of observed headroom. It therefore cannot establish a 20-point leap, nor rule out benefits on substantially harder histories. Do not extend or retune this sample to pursue significance.

### Two failed runs and incomplete error attribution

Grounding-only runs `case-28` and `case-32` failed in 651 ms and 558 ms. The frozen runner retained only the generic error name and inferred `external` from absent agent metrics; it did **not** retain enough detail to prove whether the cause was provider transport or another runtime error. This is an observability limitation, not evidence that Jev caused the failures. No retry or replacement occurred.

Following the frozen classifier excludes those entire cases from the nominal paired table; the all-32 operational table counts the failures as wrong. Both baseline and combined passed the excluded cases, so including them does not change the primary one-win/zero-loss result or p = 1.00. Future protocols should retain bounded, sanitized error phase/status details before distinguishing external from internal failures.

## What actually improved?

**One clean retrieval example: `case-25`.** The baseline context contained current age 32 but omitted both an original user statement and an already-extracted memory specifying graduation age 25. Jev nominated those existing nodes; both recovery-enabled arms then answered **32 − 25 = 7** correctly. The missing graduation-age text was absent from the baseline prompt and present after recovery. No new fact, causal parent, or larger context allowance was fabricated.

**The other apparent recovery win was not a retrieval improvement.** In `case-22`, recovery nominated nothing and the participant prompt was byte-identical to baseline. The responses nevertheless differed. Moreover, the reference treats a planned sneaker-storage change as the current location; the original source expresses future intent, and baseline explicitly noted the lack of confirmation. Keep the frozen official-rubric score, but do not present this as clean evidence of better source-faithful reasoning.

Recovery nominated nodes on **9 of 64 enabled runs**: five recovery-only and four combined. Fifteen nominated node instances actually reached the final contexts. All **27/27 no-op recovery prompts** were byte-identical to their baseline counterparts.

## Memory promotion audit

Jev accepted 201 of 234 proposed memories. The independent model audit classified 203 as supported and 31 as unsupported:

| Audit label | Promoted by Jev | Marked unverified by Jev |
|---|---:|---:|
| Supported | 183 | **20** |
| Unsupported | **18** | 13 |

Thus, on these model labels, the gate caught 13/31 unsupported proposals while flagging 20 supported ones; 18 unsupported proposals still passed. Some judgments involve compound claims, plans, and temporal interpretation, so these are not infallible human labels. The complete claims, scores, explanations, and source quotes remain in [summary.json](summary.json). There was **no answer improvement from grounding** on completed cases. These results do not justify hard-gating durable memory promotion.

## Usage and latency

- **Jev:** 136 physical requests, 1,095,598 input tokens and 16,350 output tokens; no fallback or malformed response. At the recorded $0.042/M input and free-output list price, approximately **$0.0460**. This is a list-price estimate, not an invoice or total-system cost.
- Shared extraction: 32 successful calls, 202,501 input / 58,355 output tokens. Median extraction 36.660 seconds; median Jev grounding 0.464 seconds. Shared work was physically executed once per case, not twice for the two grounded arms.
- Completed answer calls: 126, with 646,592 input / 95,790 output tokens recorded. Usage of the two failed attempts is unknown and must not be silently treated as measured zero.
- Independent judging: 66 successful completions including calibration, 233,997 input tokens including cache / 32,331 output tokens; zero exposed native retry events. Judge usage is separate from participant and Jev totals.

| Arm | Median question time, successful runs only |
|---|---:|
| Baseline | 13.642 s |
| Grounding | 14.504 s |
| Recovery | 11.121 s |
| Combined | 14.217 s |

These descriptive medians include selection where applicable; they are **not an established speedup**. Provider/generation variation exists even with identical prompts. The frozen summary also preserves all-attempt medians, which include the two quickly failed grounding runs and therefore must not be interpreted as successful-task performance.

## Integrity and evidence

All **126 completed runs** preserved their original graph prefix, exact final action read-set parents, and node/token bounds. The audit also checked that extraction and grounding received original source records, that no tool was available, and that isolated judge messages used the pinned model with no tool calls. No claim is made about unreturned states of the two failures. See [integrity.json](integrity.json).

- [Complete unedited answers and judgments](ANSWERS.md)
- [Full statistical and memory-audit ledger](summary.json)
- [Frozen raw requests, responses, states, traces, failures, and judgments](evidence/frozen-quality-pilot.tar.gz)
- Evidence SHA-256: `7d0262ef5cc4ced8f62eec5bc79e2672d69df1f22975a17de14e3c5fc8921b09`
- Executed SDK/runtime bundle SHA-256: `b9b80ff5e8cfa3d14b4bb7cde8952118fa5a32bd1e1b9e65fe16440c8fa036e5`
- Native judge thinking blocks were intentionally omitted; final judgments, configured isolation flags, usage, and transport/retry metadata were retained.

Before freezing: SDK/web typechecks, 277 tests, six Python protocol tests, build/package verification, and a fully network-denied 128-arm mock run passed. The mock run caught a persistence-namespace collision before real calls. Earlier unexecuted fixture drafts remain archived separately; no evaluation outcome informed their replacement.

### Offline verification

From this branch, with no credentials or provider calls:

```bash
EVIDENCE=$(mktemp -d)
tar -xzf evaluations/jev-quality-v1/evidence/frozen-quality-pilot.tar.gz -C "$EVIDENCE"
python3 evaluations/jev-quality-v1/audit.py \
  "$EVIDENCE/jev-quality-v1-results-20260924T022122Z" \
  "$EVIDENCE/jev-quality-v1-judgments-20260924T022122Z"
python3 evaluations/jev-quality-v1/summarize.py \
  "$EVIDENCE/jev-quality-v1-results-20260924T022122Z" \
  "$EVIDENCE/jev-quality-v1-judgments-20260924T022122Z"
```

`audit.py` is a post-run, read-only integrity check, not a replacement scorer. Do not rerun `run.mjs` to reproduce the report.

**Bottom line:** the negligible Jev price is confirmed; price is not the objection. There is one useful missing-fact recovery, no demonstrated large quality gain, and a memory gate whose rejection trade-off is not ready for adoption. Any continuation should isolate retrieval on a new, independently preregistered harder/longer corpus—not rerun or tune this one.
