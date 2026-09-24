# Frozen feasibility probe: semantic graph links, not query reranking

Freeze this file, cases.json, linker.mjs, graph.mjs, run.mjs and the SDK prototype in Git BEFORE provider calls. Record the commit and file hashes. No post-result threshold changes, added cases, replacement cases, repeat-to-pass calls or efficacy p-values.

## Question
Can Jev recognize same-fact relationships across different memory keys without conflating similar-but-different facts, allowing a bounded projection to spend fewer slots on redundant memories? Can it separately flag contradictions without choosing which claim wins?

This is a new, deliberately designed diagnostic corpus, not a random sample, a blinded human gold standard or an independent confirmatory evaluation. It is unrelated to the prior focus corpus. Candidate pairs are supplied; automatic candidate discovery, its cost and recall are NOT evaluated. The source assertions are synthetic, not a claim of real-world truth.

## Frozen judgments
36 pairs: 12 equivalent, 13 incompatible, 11 neither. Use pinned Jev `jev-1.13.0`, two independent Noul questions per pair, six pairs per request. Stable SHA-256 ordering of case IDs (salt `links-v1`) mixes categories. Send only left/right source texts, not IDs, labels or reasoning. The fixed linker prompt is part of the frozen protocol.

An equivalent link requires equivalence >= .97 and incompatibility <= .03. A conflicting link requires the reverse. Otherwise abstain (`none`). These thresholds are a conservative design choice, NOT a validated guarantee of accuracy. A false equivalent is the primary safety failure. Report every raw score, equivalence precision/recall, conflict precision/recall, and all confusions. Never merge nodes, rewrite semantic resource keys, automatically supersede a conflicting value, or treat a link as a causal parent.

Controls: current SDK (exact resource key only, all fixture keys distinct); conservative NFKC/case/whitespace-normalized exact text. Do not normalize signs, numbers, conditions or identifiers away. Retain the lower-cost exact control. No weak fuzzy-match strawman is required.

## Projection stress tests
Three dependent fixtures derived from the same twelve positive pairs: Vega six facts, Orion six facts, combined twelve facts. Each fact has two statements under different opaque keys. Source node content, order, parents and timestamps are identical across three arms. Optional-node ceilings are 8, 8 and 16 respectively; target is 16K tokens, hard ceiling 64K. This explicitly targets duplicate pressure and is not representative of all conversations.

An admitted pair permits the newer semantic node to represent the older in OPTIONAL projection selection only. Both original nodes remain in authoritative state. Preserve latest source versions, mandatory frontier, current-turn evidence, and exact visible read-set parents. Stale bindings are ignored; aliases cannot be followed transitively. Raw source graphs and displayed hierarchy are not merged. All diagnostics disclose suppressed IDs and their representatives.

Primary mechanical endpoint: distinct original fact families represented in actual compiled source IDs at the same ceiling, plus original-state preservation. No exact-old-ID metric: either verified equivalent member counts. Record both preflight compilation and actual final model-call coverage. This is source coverage, not an answer-quality score.

## Main-model canary
After the 36 fixed judgments, run all three arms on all three stress fixtures once (nine Agent runs), Latin-rotated arm order. Use real Dev `glm-5.3-flash`, temperature 0, output ceiling 4096, maxIterations 2, no tools, identical prompt/model/system/budgets. Preserve full answers, traces, errors, latency and provider usage. Inspect final answers descriptively; do not claim broad answer-quality improvement from these constructed cases. Reject aliases if either source binding is no longer current. Jev index cost is incurred once and reported separately; subsequent graph queries reuse it without another Jev request.

No automatic retries: a started but unrecorded request remains ambiguous and stops the probe. Record provider failures; don't silently count unmeasured usage as zero. Completed raw records are immutable. Do not redeploy or overwrite the running Dev service, touch commercial StateWeave or invoke frozen Infinite/SDK-build benchmarks. Execute the prototype in an isolated temporary directory in the existing Dev container with server-inherited credentials; never print/read credential files.

## Decision rule
If any false equivalent is admitted, do not recommend automatic suppression. If equivalence coverage is no better than exact matching, reject this direction as an improvement. Even with zero observed false equivalents and improved coverage, recommend only an opt-in prototype plus larger independent evaluation, not default enablement. Conflict flags are advisory and may only bring both claims to the main model/human for resolution. Preserve the previous reranking null unchanged.
