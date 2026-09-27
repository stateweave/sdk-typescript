# Jev change-impact review: positive signal, not the promised leap

**Decision: retain as an opt-in research prototype. Do not enable by default, merge for a claimed quality breakthrough, or deploy.**

The fixed run improved the preregistered end-to-end score, and two inspected cases demonstrate real recovery of a relevant assertion that both equal-budget controls omitted. It nevertheless **failed the complete adoption gate**. Improvements were smaller than the required 10 percentage points, the t statistic against the lexical control was below 3, and execution was not failure-free. On cases where every arm completed, the advantage over the cheap lexical control was only **1.86 points**, with primary paired p = **0.3125**.

This is neither “Jev does nothing” nor evidence of a reliable, substantial SDK leap. No threshold, fixture, answer, scoring rule or failed arm was repaired after observing results.

## What was implemented

One optional stage in the existing public `Agent`: given explicitly supplied new source nodes, shortlist current assertions, ask pinned `jev-1.13.0` for contradiction probabilities, nominate at most five assertions at probability ≥0.80, and follow only caller-approved direct causal dependencies to identify outputs needing review. The main model still evaluates the original evidence. Advice is derived and reversible; it neither deletes facts nor automatically corrects conclusions.

Source history remains immutable. Action parents remain the exact compiled read set. The sidecar is not a truth oracle or permission authority. See [the API and lifecycle contract](../../docs/CHANGE_REVIEW_EXPERIMENT.md).

## Frozen design and provenance

- Execution commit: `f9ac05b5d4873fcffef5c81a3e29f3e3ac9b728b`.
- September 27, 2026, **04:50:30–07:36:30 UTC**, approximately 166 minutes; normal exit 0.
- **128 source-component cases × four arms = 512 planned attempts**, all with terminal records. No replacements or further repetition.
- SciFact training-source cohort: 300 assertions, 51 positive cases, 77 no-refutation cases and 55 annotated refutations. Each assertion also has two synthetic dependent artifacts. Dependencies/history are constructed, not discovered from natural work.
- V1 development documents and duplicate claim texts were excluded when preparing v2. V3 repeats the **entire unchanged v2 cohort** under a disclosed operational amendment; it is **not an untouched independent replication**.
- `glm-5.3-flash`, temperature 0, 4,096 output tokens and two ordinary Agent iterations in every arm. No tools, transport retry or rescue of malformed outputs. The same incoming paper is supplied to every arm.
- Standard, lexical and Jev arms share a 48-node/16K estimated working target and 64K hard estimated ceiling. Lexical prioritizes its top six candidates. Jev judges 64 candidates, preferring its advisory plus up to five nominations. Full provides all 300 assertions in bounded ledger chunks under the larger 64K target: a reference, not an equal-cost superiority control.
- Cases use Latin-rotated arm order and two case workers. Fixtures, gold hash, runner, scorer and compiled runtime hashes matched their frozen manifest at completion. Participant inputs contain opaque IDs, not gold labels.

The endpoint is the equally weighted mean of positive-case F1 and negative-case exact success. Failed arms score zero. **Balanced score is not ordinary accuracy.** Statistical units are the 128 source components, not the hundreds of graph nodes or model calls. Primary inference uses the frozen one-sided paired sign-flip test, with p ≤0.025 for each of two superiority comparisons. Bootstrap intervals are the frozen stratified/component intervals; t statistics are additional required diagnostics, not an alternative route to significance.

## Primary result: all planned attempts

| Arm | Balanced score | Exact cases / 128 | Completed / 128 | Failed |
|---|---:|---:|---:|---:|
| Standard | 83.69% | 108 | 121 | 7 |
| Lexical top six | 86.31% | 110 | 120 | 8 |
| Jev change review | **92.50%** | **118** | **125** | **3** |
| Full ledger | 89.56% | 115 | 122 | 6 |

| Jev versus | Difference | Bootstrap 95% CI | Paired t (df 127) | Primary one-sided p | Wins / losses / ties |
|---|---:|---:|---:|---:|---:|
| Standard | +8.81 pp | +3.92 to +14.36 pp | 3.229 | 0.000977 | 10 / 0 / 118 |
| Lexical | +6.19 pp | +1.30 to +11.41 pp | 2.397 | 0.010742 | 9 / 1 / 118 |
| Full reference | +2.93 pp | −1.63 to +7.82 pp | 1.238 | 0.128906 | 6 / 3 / 119 |

Both equal-budget primary p values pass the Bonferroni threshold. That does **not** make the full gate pass:

- **Fail:** neither equal-budget gain reaches 10 pp.
- **Fail:** t against lexical is below 3.
- **Pass:** the full-reference lower bound is above −5 pp. This is noninferiority under the frozen endpoint, not superiority or proof of equivalent natural-history performance.
- **Pass:** the false-alert allowance is not exceeded.
- **Fail:** 24 arm failures and two Jev fallbacks violate the failure-free condition.

### Prespecified all-arm-complete sensitivity

There are **113** cases where all four arms completed. Balanced scores are standard **89.84%**, lexical **92.52%**, Jev **94.38%**, full **95.17%**.

- Jev − standard: **+4.55 pp**, t=2.027, primary p=0.0625; four wins, no losses.
- Jev − lexical: **+1.86 pp**, t=0.886, primary p=0.3125; three wins, one loss. CI **−2.27 to +5.99 pp**.

Completion-based selection is not a new unbiased primary experiment. This sensitivity shows that the larger full-cohort result includes unequal failure rates; it does not justify discarding those failures. Nor should the secondary t-test or bootstrap be substituted for the prespecified sign-flip test. The lexical control's 92.52% complete-case score also leaves only 7.48 pp of headroom on that subset—less than the required 10 pp. The bar remains unchanged.

## What actually changed the answers

These are descriptive source/read-set checks, not additional significance tests.

1. **Real recovery: `c_08de732d3633`.** The old assertion says “Deltex has no known interactions with eIF3f.” The paper describes eIF3f recruitment by Deltex1. Neither equal-budget control selected the assertion; Jev nominated it, its original node entered the compiled context, and the final answer correctly requested review. Every arm used one main call; the full ledger also answered correctly.
2. **Real recovery with a bad hint rejected: `c_8a8c9b9a51d4`.** The old assertion says “DUSP4 decreases apoptosis.” The supplied paper says DUSP4 overexpression increased chemotherapy-induced apoptosis. Jev brought the omitted assertion into context. It also nominated an extra assertion not in the frozen gold; the main model did not carry that extra nomination into its final answer.
3. **A real miss: `c_bce13a31009f`.** Jev nominated nothing for an OCT3/4 interaction assertion. Standard and Jev omitted its original node and missed the review; lexical included it and answered correctly. A semantic sidecar is not automatically better than the cheap selector.
4. **Do not credit this as recovery: `c_83e897c77468`.** Jev nominated nothing; its first prompt was byte-identical to standard, both used one main call, and both already saw the needed assertion. Jev received the gold-matching answer and standard did not. The source also concerns colorectal-cancer risk/chemoprevention whereas the assertion says cancer “treatments,” a potential endpoint ambiguity. The frozen score is retained, but this is not a clean showcase of added evidence or improved reasoning.

Across **79** comparable no-nomination pairs, all first prompts were identical. One had a better Jev final score. That difference cannot be attributed to newly recovered evidence.

### Sidecar nomination diagnostics

All **55/55** annotated refutations were present in the 64-candidate pool; lexical's first six contained **49/55**. Candidate recall therefore does not explain the sidecar's remaining omissions in this fixture.

Of 128 sidecar attempts, 126 returned validated scores; both unavailable cases were negative cases. Across those 126 responses, the fixed nomination policy produced **37 true nominations, six false nominations and 18 missed annotated refutations**: 37/43 nomination precision (**86.0%**) and 37/55 recall (**67.3%**). Two of 75 observed negative cases received a sidecar alert. The five-nomination cap did not change these threshold counts.

These are annotation-relative, conditional descriptive counts—not calibrated truth probabilities. The main Jev arm ultimately identified 49 annotated refutations, so it frequently had to do better than the sidecar. Do not turn this stage into an authoritative rejection or correction gate.

## Failures and all-attempt cost

| Arm | Rate-limit failures | Main timeout | Two output-limit responses without final text |
|---|---:|---:|---:|
| Standard | 3 | 0 | 4 |
| Lexical | 5 | 0 | 3 |
| Jev | 0 | 1 | 2 |
| Full | 1 | 0 | 5 |

The **14 output-budget failures** each received two HTTP-200 responses that stopped at `max_tokens`, reported 4,096 output tokens and contained no visible final text. They are not rate-limit failures or answers that can be salvaged by relaxing the parser. The nine HTTP 429 responses carried Z.ai code **1302**, meaning request rate limiting—not proof of a specific concurrency ceiling. All nine happened in controls; no semantic benefit should be claimed from that allocation. See the preserved [erratum](ERRATA.md).

Two additional **Jev timeouts** fell back to ordinary projection and completed; they are not included among the 24 failed arms. No failed call was retried outside the frozen two-iteration Agent contract. The precise quota dimension and competing account workload remain unknown.

### Completed v3 run, including failed-arm requests

| Provider path | Recorded request starts | HTTP 200 | Known input tokens | Known output tokens | Starts without complete usage |
|---|---:|---:|---:|---:|---:|
| Main model | 578 | 568 | 6,984,074 | 1,243,164 | 10 |
| Jev | 128 | 126 | 1,603,131 | 144,396 | 2 |

Main known input by arm: standard **1,154,768**, lexical **1,135,915**, Jev **1,219,776**, full **3,473,615**. The Jev arm additionally consumes its 1,603,131 sidecar input tokens; it is not a token-saving result against lexical. Unknown usage is **not zero**.

Successful-arm median elapsed times were 26.09s / 27.98s / 26.47s / 32.57s respectively. These include setup/audit work and differ in completed-case composition; they are not a statistically established speed ranking. Successful Jev HTTP response duration had a 240ms median. The largest reported main input was **23,344 tokens**, below 64K; maximum estimated contexts were 8,631 / 8,633 / 8,619 / 18,947. Measured provider tokens and compiler estimates are distinct.

### Earlier attempts are not hidden

| Attempt | Arm starts | Completed | Failed | Unreturned | Disposition |
|---|---:|---:|---:|---:|---|
| V1 | 13 | 8 | 3 | 2 | Shared parser incompatibility; engineering-invalid, not efficacy evidence |
| V2 | 145 | 114 | 27 | 4 | Rate-limited operational abort; includes one Jev HTTP 520 |
| V3 | 512 | 488 | 24 | 0 | Complete fixed cohort; sole scored study here |

Across all three attempts: **757 main request starts**, **167 Jev starts**, known main usage **8,767,714 input / 1,547,198 output**, known Jev usage **2,086,183 / 187,944**, and **41 request starts without complete usage**. No v1/v2 efficacy estimate is pooled into v3. See [all-attempt accounting](all-attempts.json).

## Integrity and engineering evidence

- Audited **488 returned states**: original prefixes unchanged, exact final-action read-set parents, source visibility, node/context limits and declared dependencies preserved. Failed arms have no returned successful state to certify.
- All **122 returned full-ledger states** exposed all 300 assertions. Full-ledger text visibility is distinct from individual original-node inclusion.
- All **42 nominated node instances in returned reviewed states** were actually included. A nomination ID alone is not evidence of visibility.
- **2,698 evidence files / 733,780,877 bytes** were checked for configured credential bytes and base64 forms before export: zero matches. Request headers and hidden thinking are not published.
- Post-freeze candidate commits `71b7881` and `a10d952` harden explicit refresh, approved historical dependency traversal and composition with prior selection hints. They did not alter the running experiment. Natural multi-version lifecycle behavior is covered by deterministic tests, not this one-turn efficacy study.
- Network-disabled differential replay reproduced original traces and matched frozen/candidate traces, states and answers for **125/125 returned live Jev results**; three failed Jev arms were skipped explicitly. The separate offline replay matched **128/128**. This is recorded-path compatibility evidence, not a fresh efficacy replication.
- Final local validation passed **287 Vitest tests across 40 files**, six Python protocol/accounting tests, SDK/web typechecks, the package build and package verification. Archive reconstruction reproduced the exact checksum. Commands: `tsc --noEmit`, `tsc -p web/tsconfig.json --noEmit`, `vitest run --maxWorkers=1 --minWorkers=1`, `tsc -p tsconfig.build.json`, and `node scripts/verify-package.mjs` using the existing project binaries. These are local gates, not a claim of hosted CI.
- The deployed Dev application was not changed; its Agent hash remained `1112abe8df5a444b978fb761c12afd4bd45757ae324e648cdecc58e7efdbaeb0`. Commercial StateWeave, Infinite and SDK-build were not used.

## Limits and recommendation

SciFact is public and may be in model training data. Its annotations are not a scientific truth oracle or exhaustive cross-document contradiction map. Cases share a memory pool, domain and model; their histories and dependency edges are synthetic. The lexical shortlist is ASCII-oriented, and multilingual/alias-only recall is unestablished. The frozen v2 cohort was reused operationally. Natural sessions, long-lived overlapping review groups, implicit dependencies, security decisions and universal source validity were not tested.

**Keep the prototype off by default and preserve these results.** There are credible local recoveries and a statistically positive all-attempt signal, but not the prespecified substantial, reliable leap. A future improvement would require a separately authorized, independent preregistration with adequate output-budget/load calibration and realistic changing histories—not another run or threshold search on this cohort.

## Reproduce the analysis without provider calls

```bash
python3 evaluations/change-impact-v3/restore_evidence.py /tmp/change-impact-v3-evidence.tar.gz
mkdir -p /tmp/change-impact-v3-evidence
tar -xzf /tmp/change-impact-v3-evidence.tar.gz -C /tmp/change-impact-v3-evidence
R=/tmp/change-impact-v3-evidence/change-impact-v3-f9ac05b-live
python3 evaluations/change-impact-v3/summarize.py "$R"
python3 evaluations/change-impact-v3/audit.py "$R"
python3 evaluations/change-impact-v3/accounting.py "$R"
python3 evaluations/change-impact-v3/diagnostics.py "$R"
python3 -m unittest discover -s evaluations/change-impact-v3 -p 'test_*.py' -v
```

The restoration command refuses to overwrite an existing destination. Do **not** run `run.mjs` to reproduce this report; that would start new provider work, not reproduce preserved evidence.

- [Frozen protocol](PROTOCOL.md), [summary](summary.json), [integrity audit](integrity.json), [diagnostics](diagnostics.json), [unedited accepted answers](ANSWERS.md).
- [Evidence manifest](evidence/manifest.json); archive SHA-256 **`b340b175a1646db03be0b6847468d5f4702a97581a32cf5f21fed9ac7447f810`**. Three checksum-bound chunks reassemble the exact 95,119,164-byte archive.
- Frozen runtime archive SHA-256 **`7def6de9c0fca0f0521da4be46e7bf8a310b5deadadb613d412917e33c07136b`**.
- [Dataset attribution and licenses](SCIFACT_LICENSE.md); Wadden et al., *Fact or Fiction: Verifying Scientific Claims*, EMNLP 2020.
