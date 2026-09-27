# Development results — no held-out efficacy claim

Runtime `40738b82adcbf3f462ae7e4e69934aa057624915` completed all 84 planned Jev ranking calls across the 28-case development set, with zero failed cases and complete reported token usage. Four cases concern abstention, so retrieval coverage below uses only the 24 answerable cases.

| Selection | Mean supporting-session recall | All supporting sessions /24 |
| --- | ---: | ---: |
| Lexical BM25, same exact-window packing | 84.44% | 18 |
| Indexed Noul | 89.03% | 20 |
| Direct Noul | 97.92% | 23 |
| Direct Score | 97.92% | 23 |

The shared 64-candidate pool has 97.92% mean supporting-session recall. Direct Noul and Score reach that ceiling at the session level; neither can recover the missing candidate. This does **not** establish that the selected excerpt includes every answer-bearing fact, that a final answer is correct, or that any effect will generalize. No significance test or independent-confirmation claim is made for this development comparison.

Choose **direct Noul** for the next development answer comparison: it matches Score's source coverage with a simpler response type. Observed median HTTP times were 388ms indexed, 321ms direct Noul, and 393ms Score; these are descriptive, not a proven latency ordering. Known input/output totals were 999,047/32,088; 1,017,051/32,088; and 1,026,011/26,712 respectively. All 84 starts have responses and known usage.

Calibration B also passed three real public-Agent turns with native recall, retrieving Kyoto / MAPLE-417 from an interior source span. It made three main-model and six Jev requests, with no fallback, before development ranking started. Calibration A's earlier rounding-validator failure remains separately preserved.

The next stage compares final answers on all 28 development cases across the existing SDK, the identical native pipeline with lexical scoring, and automatic direct-Noul recall. The existing SDK receives the same no-tool terminal-FINAL parser repair as the candidate. The lexical control uses an explicitly recorded evaluation-only scorer replacement (`model: lexical-ablation`, zero Jev requests), not a public opt-out API. All arms share the main model, system/task, source state, 48-node ceiling, 16K target/64K hard estimate, 16,384 output-token allowance, two iterations and no tools. One serial case worker and a 15-second minimum interval between main dispatches avoid the previous uncalibrated parallel load assumption. This does not establish the provider's actual quota dimension.

Evidence archive for calibrations A/B plus development ranking: SHA-256 `9c8e67c441b2edd2b2ac75bf2c2fc69c5b8896831acc3dd0e05f0282e9314f5d`. A scan of 403 evidence files / 25,024,353 bytes found zero configured credential-byte or base64 matches. Raw hidden thinking and authorization headers are excluded. `development-ranking.json` and `summarize-ranking.py` preserve the descriptive results. Nothing is deployed; the 196 held-out cases remain unused.
