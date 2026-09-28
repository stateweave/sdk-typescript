# Native Jev recall: large held-out quality gain; full acceptance gate failed

## Decision

On the single frozen 196-case cohort, native recall met the requested practical and statistical quality thresholds against both controls. **This is not a full acceptance pass:** the scored abstention comparison against lexical and the lexical completion threshold failed. There is also a known source-window encoding defect, corrected only in separate post-run engineering. **Do not merge, deploy, or represent this as universally better default behavior.**

The result supports a substantial retrieval-heavy answer-quality gain for this filtered public corpus and these exact model/configuration choices. It does not establish general coding, tool-use, long-running interaction, multilingual retrieval, or production safety gains.

## Primary result — failures retained as incorrect

| Arm | Correct / 196 | Accuracy | Completed | Abstention / 16 | Judge disagreements |
|---|---:|---:|---:|---:|---:|
| Parser-matched current SDK | 132 | 67.35% | 195 | 12 | 2 |
| Lexical pipeline control | 137 | 69.90% | 192 | 14 | 0 |
| Native Jev recall | 173 | 88.27% | 194 | 12 | 3 |

| Native versus | Gain | Wins / losses / ties | Paired t (df=195) | Exact two-sided McNemar p | Holm-adjusted p | Stratified paired bootstrap 95% CI |
|---|---:|---:|---:|---:|---:|---:|
| Parser-matched current SDK | +20.92 pp | 49 / 8 / 139 | 5.877 | 2.7168526e-08 | 5.4337051e-08 | +14.29 to +27.55 pp |
| Lexical pipeline control | +18.37 pp | 42 / 6 / 148 | 5.582 | 1.0087482e-07 | 1.0087482e-07 | +12.24 to +24.49 pp |

Each comparison clears ≥10 percentage points, t≥2.5, Holm-adjusted p<.05, and a positive confidence-interval lower bound. The case/source component—not each vote or excerpt—is the analysis unit. The two judge calls are not independent samples.

## Predeclared robustness and failed gates

- **All three arms complete (n=190):** native gain +22.11 pp versus current SDK; +18.42 pp versus lexical. Both clear the predeclared 10-point bar. Selected subset; not a replacement primary endpoint.
- **Non-preference cases (n=176):** native gain +19.32 pp versus current SDK; +17.61 pp versus lexical. Both clear the predeclared 10-point bar. Predeclared robustness against permissive partial-personalization scoring.
- **Scored abstention gate fails:** native 12/16, lexical 14/16, current SDK 12/16. Source-aware review finds important label ambiguities in both directions; see `SOURCE_FIDELITY_REVIEW.md`. Those findings do not change the frozen labels or gate.
- **Completion gate fails for lexical:** 192/196 = 97.96%; the ≥98% rule required at least 193. Standard 195/196 and native 194/196 pass. Do not round 97.96% up to a passing 98%.
- **Fallback gate passes:** native 3/196 = 1.53%, including the fallback in a failed arm; maximum allowed was nine.
- The frozen integrity checks pass for 581 returned states and all seven preserved failed committed states. They did not test Unicode-scalar boundaries and must not be presented as proving their absence.

Full machine-readable checks are in `confirmatory-summary.json`. The acceptance decision remains **false**; no threshold, case, label, sample size, or stopping rule was changed.

## By task group

| Group | Cases | Current SDK | Lexical | Native |
|---|---:|---:|---:|---:|
| abstention | 16 | 12 | 14 | 12 |
| knowledge-update | 32 | 21 | 26 | 30 |
| multi-session | 32 | 18 | 16 | 27 |
| single-session-assistant | 32 | 28 | 27 | 32 |
| single-session-preference | 20 | 11 | 13 | 18 |
| single-session-user | 32 | 20 | 20 | 28 |
| temporal-reasoning | 32 | 22 | 21 | 26 |

An additional **post-hoc, descriptive-only** exclusion of all 16 abstention cases leaves n=180: current SDK 120, lexical 123, native 161. It is not a repaired acceptance endpoint.

## What was compared

- Measured implementation `2cba138f4afec03f83a1269622a089e2005cb5b6`; final freeze commit `a1a3e33591c57a44c549422974c5cbee89a228ba`; freeze SHA-256 `a02c1444477a335dadb87e5317a4ad16011b697949e096b9bd85e3a5f6828d7c`.
- Standard: deployed SDK `762c773185e6f7c33358d2c7195f53c39e20aed5` plus the same narrow no-tool terminal-FINAL parser repair used by both candidates.
- Lexical: the complete native source-excerpt pipeline with an evaluation-only lexical ranking override. Native: the ordinary mandatory-Jev candidate Agent, with direct Noul relevance scoring and visible fallback. Jev judges relevance, not truth.
- Same original historical sources, query, neutral task instruction, `glm-5.3-flash`, temperature zero, no tools, two iterations, 16,384 output-token cap, causal 48-node / 16K target / 64K hard estimated prompt ceiling. Jev `jev-1.13.0`, 15-second deadline, at most 64 candidates and 12 windows, no more than two nonoverlapping windows per source.
- Exactly 196 held-out cases, fixed before provider calls; source-support families exclude development/prior-pilot overlap. No optional stopping, replacement case, failed-arm replay, generation transport retry, or second trajectory. One native arm used its allowed second iteration to repair an action envelope and then completed.
- Blind `openai-codex/gpt-5.6-sol`, low reasoning, native isolated Pi flags, no tools/context/extensions/session, two order-reversed calls per case after 32 calibration decisions. Both votes must pass. All five arm-level disagreements count incorrect. Source text is not given to the judge: this is a reference-based correctness endpoint, with the documented limitations.
- Generation ran 2026-09-27; judging/scoring finished 2026-09-28 UTC. The existing development web application, commercial product, docs and historical benchmarks were not deployed or restarted.

## Failure and usage ledger

| Provider | Starts | Captured responses | HTTP statuses | Known input tokens | Known output tokens | Starts without complete usage |
|---|---:|---:|---|---:|---:|---:|
| main | 589 | 589 | {"200": 582, "429": 5, "500": 2} | 5,382,768 | 477,873 | 7 |
| jev | 196 | 195 | {"200": 193, "400": 1, "520": 1, "None": 1} | 7,017,840 | 221,178 | 3 |

Judging including calibration: **394 calls**, 242,340 known input/cache tokens, 52,416 output tokens, 5 messages without complete usage, and 8 exposed retry events. Pi exposed five automatic retry starts across three judge invocations (eight start/end events), yielding 399 assistant messages: 394 successful and five errors. The errors carry zero-valued usage placeholders, which remain unknown—not proof of zero consumption. These are the preserved native Pi retries, not controller replays or newly requested judgments. Hidden reasoning text was not persisted; a numeric reasoning-token field is not added again to output usage.

The main failures were five HTTP 429 / Z.ai 1302 rate-limit responses and two HTTP 500 encoding rejections caused by one split astral character. Code 1302 does not establish a concurrency cap. The three native fallbacks were one Jev HTTP 520, one 15,001 ms TimeoutError with no response, and one HTTP 400 caused by that encoding defect. All remain in primary scoring and accounting.

A recorded start is not proof of provider receipt; missing usage is not zero. Jev added 7,017,840 known input tokens; it is not a token-free improvement. Dollar charges are not measured. The 15-second main-start spacing contaminates agent wall-time comparisons, so no product speedup is claimed. Median Jev HTTP-attempt time was 337 ms; maximum observed input was 14,762 main tokens and 42,064 Jev tokens.

| Failed arm | Main HTTP status |
|---|---|
| `c_0d13024deedf9311.native` | 429 |
| `c_a893716a2b8135e6.standard` | 429 |
| `c_c3f4f5b45606d98f.lexical` | 500 |
| `c_c3f4f5b45606d98f.native` | 500 |
| `c_d037e58f62350e61.lexical` | 429 |
| `c_eb0c857af19d2332.lexical` | 429 |
| `c_fcc8b1c87bde9a47.lexical` | 429 |

## Attribution, engineering and interpretation

Native versus lexical has three byte-identical first-prompt cases and no outcome differences in those cases. This limits a simple no-op explanation, but does not make read-set exposure proof of entailment. Full-span visibility and original source identities were audited; clock-sensitive hierarchy labels can still change prompt bytes even when selected source spans match.

`UNICODE_HARDENING.md` documents the separate post-run correction. Ten focused regressions and the 293-test SDK suite pass. All 386 successful lexical/native paths preserve exact recorded prompt/trace/state/answer parity; all 196 indices have scalar-safe exact source windows, with only the known failing case changing. Six failed candidate paths receive no replacement outcome. Two explicitly simulated checks validate the failing fixture without any provider call. This is engineering evidence, not a live rerun or an upgrade of the measured result.

The frozen preflight also preserved all dated source occurrences: six holdout records reuse a source ID with different date headers. That importer repair preceded the freeze and was identical across all arms; fixtures, gold and exclusions were not edited. Offline engineering attempt A failed its audit; B/C passed. The first waiting postprocessor was stopped before any provider call because the app image lacked Python; its replacement scanned on the host without changing generation, judge flags or scoring.

Limitations: a filtered public LongMemEval corpus rather than an official leaderboard run; possible pretraining contamination and residual dependence through distractors/templates; one main-model family and one short, no-tool cold-state task per case; source-blind reference judging, permissive preference and temporal rubrics, and imperfect abstention labels; no independent live validation of the post-run patch. Native setup adds credentials, privacy exposure, latency and reliability obligations even if its token price is low.

**Recommended next step:** review the source-aware abstention findings and fix genuine missing-evidence behavior under a new, independently frozen source-grounded protocol. Do not rerun this cohort to obtain a cleaner p-value or erase its failed gates. Any production decision requires explicit human review.

## Evidence and reproduction

- `confirmatory-summary.json`: original scored output, all case decisions, comparisons, complete/non-preference sensitivities, request-start accounting, scans and gate.
- `confirmatory-integrity.json`: original source/read-set audit and exact generation-file hashes.
- `CONFIRMATORY_ANSWERS.md`: every question, reference, final answer/failure and both original judge reasons.
- `confirmatory-diagnostics.json`, `SOURCE_FIDELITY_REVIEW.md`, `UNICODE_HARDENING.md`, `unicode-replay.json`: clearly separated post-run diagnostics.
- Generation archive: `native-recall-v1-2cba138-evidence.tar.gz`, 149,179,611 bytes, SHA-256 `00c24b08090d44cb2aff37c3b7337cdccb82471ead8bbd3a28400d69dcd25aa5`, verified on Headquarters and Eve. The judgment/final-evidence archive is identified in `confirmatory-evidence-manifest.json`.
- Configured main/Jev credential scan: 2,947 files / 523,860,236 bytes. Configured Pi-auth plus hidden-block scan: 4,326 files / 526,328,710 bytes. Zero exact/raw-base64 configured credential matches and zero persisted hidden content blocks; this is a bounded scan, not proof that every conceivable secret format is absent.

Reproduce scoring from preserved evidence using the frozen scripts and original audit/scan files—not new model calls:

```sh
python3 evaluations/native-recall-v1/score-confirm.py \
  <generation-root> <cohort-v2> <judgments> \
  <original-integrity.json> <provider-scan.json> <pi-scan.json>
```

The one-shot `/data/native-recall-v1-confirmation-started.json` receipt must never be removed to replay. PR #93 preserves the measured implementation, frozen result, failed gates, post-run hardening, and the later human-authorized product promotion as distinct facts.
