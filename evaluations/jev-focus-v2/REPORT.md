# Jev focus in Dev: works, but no measured answer-quality gain

**Recommendation: keep deterministic focus as the default.** Flat and hierarchical Jev work end to end, but this diagnostic does not justify their added inference overhead.

## Measured result

All 36 runs completed their lifecycle: twelve fixed cases × three modes. They ran inside the actual Dev container at SDK commit `23050b361c5e128305f6fd9e82bdeca3b249266d`, GLM `glm-5.3-flash`, and pinned Jev `jev-1.13.0`. This is a diagnostic replay on a reused designed corpus—not independent confirmation or a powered quality study.

| Metric | Deterministic | Flat Jev | Hierarchical Jev |
|---|---:|---:|---:|
| Correct completed answers | 11/12 | 11/12 | 11/12 |
| Preregistered strict full-pass | 10/12 | 10/12 | 10/12 |
| Median complete-task time | 18.424s | 18.771s | 18.066s |
| Median Jev selection time | — | 0.390s | 0.798s |
| Answer-model input tokens, all attempts | 54,910 | 56,941 | 57,013 |
| Answer-model output tokens, all attempts | 14,666 | 15,489 | 13,642 |
| Additional Jev input tokens | 0 | 40,000 | 78,046 |
| Additional Jev output tokens | 0 | 5,229 | 8,033 |
| Completed Jev API calls | 0 | 12 | 28 |
| Jev fallbacks / incomplete usage | 0 / 0 | 0 / 0 | 0 / 0 |

Jev time is **already included** in complete-task time; do not add it again. Small differences in end-to-end median do not establish a speed advantage. Provider token counts are not interchangeable dollar prices, and no dollar-cost claim is made. Prompt/answer budgets and starting states were matched. All successful runs preserved the original graph, exact compiled answer parents and prompt/node ceilings, read the real scoped `probe.txt`, and included its current tool-result evidence.

## Why the failures matter

- **Shared failure, payment-retry:** all three arms retrieved enough information and generated the appropriate proposed answer, but the SDK's completion guard interpreted “which remedy and verification codes apply?” as an imperative to modify files. It repeatedly rejected the final for missing mutation evidence and exhausted five iterations. This is a real SDK failure, not a provider outage or a Jev loss. It remains a failure in the frozen result. A separately tested public-runtime correction exempts only the bounded informational “which/what … apply?” clause; explicit “Apply the patch”, “Can you apply …”, and a later imperative still require mutation evidence. Frozen runners are unchanged. Its later release validation is not retroactively substituted into this table.
- **One extra strict-evidence miss per arm:** flat/pilot-city, deterministic/revoked-approver, hierarchical/exact-config. Each read the original required atom before the tool call, then emitted an identical keyed semantic value as a new causal node. The final read set contained that current replacement, not the exact original source ID demanded by the preregistered scorer. All three answers were correct. This is version-sensitive scoring, not proof that the answer was ungrounded. The original 10/12 scores remain unchanged; the source/lineage explanation is a post-run diagnostic, not a replacement endpoint.
- Hierarchical mode therefore has one strict-criterion win and one loss versus each comparator, ten ties, and **no answer-quality win**. No p-value or generalization claim is warranted.

## Complete case ledger

✓ = strict full-pass; V = correct answer with the identical-version issue above; E = shared completion-guard failure.

| Case | Deterministic | Flat | Hierarchical |
|---|---|---|---|
| payment-retry | E | E | E |
| launch-gate | ✓ | ✓ | ✓ |
| backup-retirement | ✓ | ✓ | ✓ |
| pilot-city | ✓ | V | ✓ |
| quiet-contact | ✓ | ✓ | ✓ |
| cold-package | ✓ | ✓ | ✓ |
| corrected-port | ✓ | ✓ | ✓ |
| revoked-approver | V | ✓ | ✓ |
| revised-launch | ✓ | ✓ | ✓ |
| exact-config | ✓ | ✓ | V |
| budget-balance | ✓ | ✓ | ✓ |
| missing-fact | ✓ | ✓ | ✓ |

## What was shipped and verified

- Opt-in Settings modes: Off, Flat, and Topics → Subgraphs → Atoms. Default remains Off; Traditional is unchanged.
- Multiple nominated branches, bounded source-backed region excerpts and a global candidate bypass. Original graph truth, supersession, actual read-set parents and source budgets stay with StateWeave.
- Fresh current-turn tool results outrank old preferences. Native caller cancellation propagates; unavailable/malformed/timed-out scoring has an explicit deterministic fallback, retaining completed-stage usage and flagging unknown remainder.
- Separate provider-measured Jev token/call/latency records persist in the paired session ledger and render after refresh.
- Real Dev HTTP canary: default-off marker storage before redeploy, flat recall after redeploy, then hierarchical recall. Both conversation arms returned the same exact marker; only StateWeave recorded Jev use. Flat used 684 input / 58 output tokens in 432ms; hierarchy used three calls, 2,064 input / 156 output in 928ms. This is plumbing evidence, not benchmark evidence.
- Desktop, 390px and 320px browser checks passed default-off settings, both selection modes, reload persistence, rendered separate overhead, zero page errors and zero document overflow.
- The original v1 live calibration was stopped after discovering the scorer's reserved-FINAL-envelope collision. Six finalized arms and one interrupted start are preserved, with no efficacy inference. V2 corrected the API/scorer contract and used Dev's actual 4,096-token output ceiling, equally across all arms. No cases were replaced or added.
- Infinite remains stopped at zero turns. The completed, unscored SDK-build run remains `sdk_20260719185951_ede521c1`. Commercial StateWeave and public docs were not deployed or changed.

## Reproduce and inspect

- [Frozen diagnostic protocol](PROTOCOL.md)
- [Machine-readable summary](summary.json)
- [Complete diagnostic evidence](evidence/complete-diagnostic.tar.gz), SHA-256 `c101f8f8e347746baa8d70282ed18ba1e86f013b3220cb12028150db3b3d6e45`.
- [Invalid calibration evidence](../jev-focus-v1/evidence/invalid-calibration.tar.gz), SHA-256 `a20a4c31d1f4daffed3d4c3b087288f6656cd08b5f6f48753ea83d484e3ec7c0`.
- Fixture SHA-256: `1383bb9de5b180598ea2e76d9e0e275129f5c7a3f4f3890dbfa0015d1d9d02e4`.

Each arm record includes the starting-state hash, exact task, required IDs, raw trace, compiled contexts, returned state or terminal metrics, Jev stage judgments and timings. Evidence is synthetic and credential-free. Aggregation is reproducible without provider calls:

```sh
mkdir -p /tmp/jev-report
 tar -xzf evaluations/jev-focus-v2/evidence/complete-diagnostic.tar.gz -C /tmp/jev-report
node evaluations/jev-focus-v2/summarize.mjs /tmp/jev-report/stateweave-jev-diagnostic-v2-results-20260923
```

Do not rerun this corpus to seek significance. A future test should use independent, realistically difficult histories and a version-aware evidence metric frozen in advance. Until then, Jev is a working experimental option—not a demonstrated upgrade.
