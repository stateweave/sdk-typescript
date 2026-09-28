# Native recall: development results

**Promising development evidence, not independent confirmation. Nothing is merged or deployed.** The 196-case held-out split has not received participant model calls. The baseline remains deployed commit `762c773185e6f7c33358d2c7195f53c39e20aed5` plus the same narrow no-tool terminal-FINAL parser repair used in every arm.

## Answer quality

Measured runtime: `4073d2b6593138c806900cfda4c2e250b63311cf`. All 84 planned arms completed, each with one main-model call. A calibrated, isolated `openai-codex/gpt-5.6-sol` / low judge evaluated every answer in two reversed anonymous orders. Both judgments must pass. There were no order disagreements. These post-development statistics are exploratory and do not constitute the held-out test.

| Arm | Correct / 28 | Abstentions / 4 | Main input / output tokens |
|---|---:|---:|---:|
| Existing SDK | 18 | 3 | 319,813 / 25,323 |
| Same native pipeline, lexical ranking | 21 | 4 | 227,751 / 21,641 |
| Ordinary native Jev Agent | 27 | 4 | 225,523 / 23,589 |

| Native versus | Difference | Paired t (27 df) | Exact paired p | Holm-adjusted p | Stratified bootstrap 95% CI |
|---|---:|---:|---:|---:|---:|
| Existing SDK | +32.14 pp | 3.576 | .00390625 | .0078125 | +17.86 to +46.43 pp |
| Lexical | +21.43 pp | 2.714 | .03125 | .03125 | +10.71 to +32.14 pp |

Native has nine wins/no losses against the existing SDK and six wins/no losses against lexical. The one native miss is a temporal airline-frequency question; both controls also miss it. The practical and numeric targets are met **on this development set only**. Small samples, design selection, public-corpus contamination, permissive preference rubrics, shared ordinary distractors and model-specific performance limit interpretation.

### Inspect the wins, not just the totals

[Unedited diagnostic answers](DEVELOPMENT_DIAGNOSTICS.md) preserve all six lexical comparisons that favor native plus the shared miss. Examples include the second previously mentioned company, a fundraising date, an explicitly stated identity rather than inference from passport discussion, and the user's actual guitar-upgrade comparison.

The garden-dinner win is weaker evidence: native uses basil/mint recipe history and mentions cherry tomatoes, but still says the homegrown inventory is not explicit. It passes the established partial-preference rubric, not a strict full-inventory recall criterion. It is not described as a clean recovery of every required fact. A post-hoc conservative sensitivity that withholds this one native credit leaves five lexical wins/no losses: +17.86 pp, t=2.423, exact p=.0625. This does not replace the original scores; it shows why the development result needs confirmation. One correct native answer is returned as JSON-shaped final text; correctness scoring is not a guarantee of polished presentation.

These are answers about supplied conversations, not independently verified world facts about companies, flights or personal identities.

## Retrieval design selection, before answering

Runtime `40738b82adcbf3f462ae7e4e69934aa057624915` compared all three designs on all 28 development cases. There were 84 successful Jev requests, no failed cases and complete reported usage. Four abstentions are excluded from supporting-session recall denominators.

| Selection | Mean supporting-session recall | All supporting sessions / 24 |
|---|---:|---:|
| Lexical | 84.44% | 18 |
| Indexed Noul | 89.03% | 20 |
| Direct Noul | 97.92% | 23 |
| Graded Score | 97.92% | 23 |

The common candidate pool's mean session recall is 97.92%. Direct Noul matches Score and was selected for its simpler response contract. Session presence does not establish that the answer-bearing span was selected. See `development-ranking.json` and `CALIBRATION.md`; the initial rounded-Score validation failure remains preserved.

## Operational accounting

The answer phase contains 84 main requests/responses, all HTTP 200, with 773,087 reported input and 70,553 output tokens. There are 28 Jev starts/responses: 27 HTTP 200 and one HTTP 520. Known Jev usage is 979,683 input and 30,942 output; **one start has unknown usage, not zero**. The HTTP 520 took the normal lexical fallback and its final answer was correct in every arm. It remains in all primary calculations.

The 58 judge invocations comprise two calibration packets (32 decisions) plus 56 answer packets. They report 37,328 input tokens including cache reads/writes and 7,955 output, with zero exposed retry events. Calibration costs are separate from participant costs. Earlier adapter calibration and ranking requests are retained, not pooled as answer-quality evidence.

Successful agent wall medians are 22.062s / 15.595s / 17.838s for existing / lexical / native. **They include the study's shared 15-second dispatch throttle**, so they are not a native product-speed benchmark. Provider HTTP medians exclude that wait. The extra Jev input is additional work, not main-token savings.

## Integrity and post-run hardening

The offline audit checks 28 cases and 84 returned states, immutable original sources, exact action read-set parents and budgets. All 336 selected lexical windows and 336 native windows were fully present in their recorded prompts. It makes no claim that source exposure proves entailment.

Literal prompt hashes are never normalized in the primary evidence. The fallback case `c_e56c8235beed1aa0` has identical visible source windows but a different non-evidence cluster label (`system` versus `user_input`). Legacy cluster type-count ties use wall-clock member ordering; identical source IDs do not imply identical complete prompts. All three answers in that case are correct. This is not evidence recovery.

After answering, deadline-safe stream cleanup, stricter span/packing validation and continuity protection were added. A retrieval shortlist must not suppress the immediately preceding correction, even if that correction has no query-word overlap. Both causal and molecular tests cover this under the existing node limit. The existing frozen GraphFrame projection implementation is unchanged.

`replay.mjs` first reproduces the original traces, then compares two genuinely distinct frozen and hardened runtimes. All 56 returned lexical/native paths reproduce identical prompts, source state and final answers with zero network calls. Recorded node timestamps are restored only inside replay to reproduce clock-sensitive labels. This certifies these recorded paths, not new live efficacy or every natural-history lifecycle.

Current checks: 283 SDK tests in 39 files; 21 Python protocol/judge/statistics/accounting tests; SDK/web typechecks; SDK build/package verification; exact-source audit and distinct-runtime replay. The [confirmation protocol](CONFIRMATORY_PROTOCOL.md) additionally requires a ≥10 pp gain on non-preference cases and full-byte score/provenance binding. The [engineering preflight](PREFLIGHT.md) preserves the simulated importer failure and corrected full-cohort checks. The held-out protocol must be committed and hash-bound before any held-out calls. A successful benchmark would still be limited to this model, budget and filtered public corpus; it would not establish a universal SDK improvement or authorize deployment.

## Evidence

- `development-answers.json`: complete scored case ledger and comparisons.
- `development-accounting.json`: every answer-phase request, status and known/unknown usage.
- `development-integrity.json`: source/read-set/visibility checks.
- `development-replay.json`: frozen versus hardened recorded-path parity.
- Ranking/calibration archive SHA-256: `9c8e67c441b2edd2b2ac75bf2c2fc69c5b8896831acc3dd0e05f0282e9314f5d`.
- Answer archive SHA-256: `dd1f901e4f35f4066e749a2ac558dc52abe5f5c4c679eae1b0b6bb1468115d72`.
- Measured runtime archive SHA-256: `4c99ec9d0f8180e4221fe46461e5de249942efb244261e07b3c25adca6d88315`.
- Parser-matched baseline archive SHA-256: `ec5881ecbd997c0a026426a7690ac1b2935fba5cc817270123bbfa7783f71397`.
