# Frozen change-impact experiment v1

## Question and authority
Can optional Jev-assisted change review materially improve StateWeave's identification of stored assertions contradicted by newly received evidence, beyond both the unmodified projection policy and an inexpensive lexical candidate selector?

This is a research-ledger stress adaptation, not a medical product, live user study, chronology benchmark, or proof of a universal agent capability leap. Source claims are not endorsed as true. Suggestions mark review, never deletion, automatic correction, permission, or proved falsehood. The proposed runtime preserves source nodes and exact action read-set parents. Explicit caller-approved premise→artifact→report edges demonstrate deterministic impact propagation; this experiment does NOT establish automatic discovery of implicit decision dependencies.

## Independent source and sample
SciFact (Wadden et al., EMNLP 2020), official development split: 300 externally authored scientific claims with human evidence/contradiction annotations. Release archive SHA-256: 11c621288d41ac144d29b13b0f8503b3820b7d6e8b1f6ff24dff335c196d76be. Claims/annotations CC BY 4.0; abstracts ODC-By 1.0; attribution and original license included.

Before provider calls, connect evidence-document IDs sharing any annotated claim. Select exactly one document per connected component by seeded SHA-256 order. This yields 164 source-component cases: 62 with at least one annotated contradiction, 102 without; 64 contradicted claim/document pairs. Use every selected case, no replacement or optional extension. Each case begins with the same 300-claim ledger and 600 explicitly dependent artifact/report nodes, plus system and incoming source. Cases reset independently. All 300 candidate claim texts, source paper text, and neutral opaque IDs are participant-visible; labels, original IDs, evidence sentence annotations, and source/claim mappings remain only in private-gold.json, absent from the runner bundle. The 164 source components—not 900 graph nodes, 64 candidate judgments, or 656 arm runs—are the units of statistical analysis.

This public benchmark may overlap foundation-model training. The history and dependency scaffolding are programmatic, not organic recorded user sessions; scientific statements and reference labels are external, not invented for Jev. Unannotated cross-document contradictions may exist; frozen benchmark labels remain the scoring reference, and any disagreement audit must not silently relabel the result.

## Arms
All arms run the actual public Agent and AnthropicModel adapter with glm-5.3-flash at temperature 0, output ceiling 4096, maxIterations 2, no tools, identical neutral task/provider instructions, and causal context mode. Completion-evidence enforcement is false equally across arms because this is an informational no-tool task; the existing lexical workspace guard otherwise misclassifies the word 'review'. Every task includes the COMPLETE incoming evidence so ordinary lexical projection is not denied its subject matter.

1. **standard**: current SDK default 48-node / 16K target / 64K hard prompt budget, no change reviewer.
2. **lexical**: same Agent and budgets, with the top six BM25-like incoming-evidence matches preferred. Uses the EXACT candidate ranking that Jev receives, not a weakened straw baseline.
3. **jev**: same Agent and budgets, top 64 lexical candidates, one pinned jev-1.13.0 Noul per candidate asking whether new evidence contradicts it. Threshold 0.80, at most five nominees, one explicitly advisory verification node plus those five original nodes preferred. No threshold tuning. Review metadata reports actual inclusion, candidate IDs, probabilities and provider usage. Candidate nominations are distinct from final main-model judgments.
4. **full**: full-context reference, same model and Agent, 48-node limit but 64K target/hard budget; up to five source-parented resource chunks (≤10,000 serialized characters each) contain all original claim texts and IDs, preferred with the incoming paper. Chunking respects the existing compiler's 12,000-character resource rendering cap. This intentionally larger-context reference tests whether bounded selection approaches a read-everything answer, not an equal-cost superiority arm. Runtime assertions require all original texts to be visible.

Registered edges cascade each flagged claim to its note and report. Model results are expressed in original entry IDs, not inferred anonymous IDs. The final output contract is `FINAL: REVIEW: m_..., m_...` or `FINAL: REVIEW: NONE`; the scorer accepts only exact known unique entry IDs after Agent's ordinary FINAL parser. It does not ask Jev or another model to grade itself.

## Ordering, transport and persistence
Four-arm Latin rotations by frozen case index; two independent case workers, no parallel arms of one case. One immutable .started file before every arm, and request/result records before/after every actual HTTP call. Log body, status, actual returned model, usage, duration and sanitized error phase; never headers/keys. Omit hidden thinking blocks. Main adapter and Jev returned model names must match pinned names. No transport retries or silent replay. The ordinary Agent may use its second iteration for malformed output, equally across arms; every request is accounted. A crashed/ambiguous partial run is retained, never automatically restarted. Complete planned arms once, then stop. Launch under a two-hour process timeout; a timeout produces an incomplete experiment, not permission to replace cases.

Freeze protocol, cases, gold, runner, summarizer, and runtime in a Git commit before live calls. Record source and compiled-module hashes, commit, execArgv, and offline/live identity in manifest before execution. Complete the real serialization/transport/Agent/scorer pipeline with clearly marked OFFLINE mocks before freezing. Mock results are never efficacy evidence. No live threshold search or calibration using held-out results.

## Endpoints and statistical analysis
Primary operational score per case: F1 on the set of contradicted claims when the gold set is nonempty; otherwise 1 for a correctly empty predicted set and 0 for any false alarm. A failed, malformed, unreturned, or integrity-violating arm scores zero, including negative cases. Aggregate equally across the positive and negative strata (balanced score), so merely returning nothing scores 0.5, not 0.62.

Compare Jev to standard and lexical, paired by source component. Weight each case by N/(2 × stratum size); the mean paired weighted difference equals the balanced-score gain. Primary inference: one-sided paired sign-flip, exact for ≤18 nonzero differences, otherwise 100,000 seeded draws with plus-one correction. Apply Bonferroni across the two required superiority comparisons: each p≤0.025. Also report paired t, df, two-sided t p, win/loss/tie counts, 10,000-draw source-component/stratum bootstrap 95% intervals, exact set accuracy, positive F1, negative success, TP/FP/FN, raw predictions and failures. Seed 20260927. Paired-t normality is approximate for bounded weighted outcomes; primary permutation evidence and effect magnitude matter more than a large t alone.

Predeclared meaningful-leap bar for THIS fixture only:
- balanced-score gain ≥0.10 versus BOTH standard and lexical;
- one-sided primary p≤0.025 and paired t≥3 versus BOTH;
- Jev-versus-full-reference bootstrap lower bound ≥−0.05;
- no more than three additional false-alert cases versus either equal-budget baseline;
- all 656 planned arm records complete without failure, Jev fallback, source-prefix change, omitted incoming evidence, budget breach, or incorrect answer parents.

Power planning is a sensitivity calculation, not a promise: at paired weighted-difference SD 0.45 and N=164, the additional t≥3 gate gives approximately 80% power for a 13.5-point gain and 90% for a 15-point gain under a normal approximation. A 10-point gain may be underpowered; larger variance or a near-ceiling baseline further limits this cohort. We do not resize the sample after observing either variance or outcomes.

All-arm-complete sensitivity is reported separately; generic errors are never presumed external. Successful-task latency is separate from all-attempt timing; all physical Jev/main usage is counted, unknown failed-request usage remains unknown. Sidecar-only accuracy, candidate recall, actual selected originals, model overrides of advice, and token/latency tradeoffs are descriptive diagnostics—not substitute primary endpoints. No independent replication or perfect accuracy is claimed even if this gate passes. Prior reranking/grounding null findings remain preserved.

## Verification and limitations
Unit/scale tests cover exact source preservation, explicit-edge-only transitive propagation, forged IDs/scores/model identities, supersession, bounded input, callback mutation, abort/rollback, disabled/no-op projection equivalence under fixed clocks, and thousands of memories. Live assertions cover every completed state and trace. No-op prompt equality is measured, not assumed: legacy projection labels can be sensitive to node timestamp ties.

Candidate recall is capped at 64; >1200-character claims and >12000-character sources are unsupported by this bounded adapter. In this corpus every claim is ≤204 characters. Links use exact immutable IDs and caller-approved direct causal edges; no model-invented dependency is trusted. Current-head filtering never silently rebinds an old relationship. The reviewer runs for explicitly supplied changedNodeIds at turn entry; it is not a background scheduler, automatic per-tool watch service, or full production semantic index lifecycle.

No default promotion or production deployment is authorized by a significant result alone.
