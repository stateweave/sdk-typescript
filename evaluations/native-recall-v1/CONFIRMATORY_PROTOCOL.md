# Native source recall: one-shot held-out protocol

Status: freeze this protocol, scorer, runner, judge and compiled runtimes before the first held-out provider call. Development findings are not confirmation. No deployment follows automatically.

## Question and sample

Does the ordinary native-Jev Agent materially improve historical-conversation answer correctness over (a) the deployed SDK with a shared parser repair and (b) the identical native pipeline with only lexical ranking?

Use exactly the already sealed 196 held-out cases in cohort-v2: 16 abstentions, 32 single-session-user, 32 single-session-assistant, 20 preference, 32 multi-session, 32 temporal, 32 knowledge-update. No additions, replacement, pruning, selective retries, second trajectory or threshold changes. Earlier pilot families and other selected cases' answer-support sources were excluded before providers; own supporting sources remain. Ordinary distractors can overlap. Public-corpus pretraining contamination is possible. These modified histories are not an official LongMemEval leaderboard submission or evidence about every model or real-world task.

Mechanical preflight found six held-out cases containing a repeated session identifier with an identical conversation body but different date headers. The fixed importer preserves each occurrence with its own resource key in **all three arms**; otherwise the SDK would interpret them as resource replacements. Unique identifiers keep their previous key. Participant bytes, gold, selected cases, split and source-family exclusions are unchanged. `sourceRecords` binds each input ordinal to its exact node/key; the older single-value `mapping` field is not a complete occurrence map. The failed simulated importer attempt is retained separately and provided no answer-quality feedback.

The source-component case is the statistical unit, never individual judge votes, windows or API questions. Primary accuracy gives every case equal weight. Seven strata are retained for bootstrap sampling, not reweighted to equal category importance. Generalization assumes cases are sufficiently independent conditional on these strata; shared distractors, question templates and a single public corpus limit that assumption.

## Arms and execution

- **Standard:** deployed `762c773185e6f7c33358d2c7195f53c39e20aed5`, with only the identical narrow no-tool terminal-FINAL repair.
- **Lexical:** the complete candidate native runtime; an explicitly recorded evaluation-only scorer replacement preserves lexical candidate order. It is not a consumer-facing off switch.
- **Native:** the normal `Agent`, with mandatory configured credentials and automatic direct-Noul Jev recall. Temporary/invalid replies take the ordinary, visible lexical fallback. Missing/rejected credentials do not silently fall back.

Same exact source state, query, neutral system, `glm-5.3-flash`, Anthropic-compatible Z.ai endpoint, temperature 0, no tools (zero recorded tool-call actions required by this deliberately tool-free study), completion-evidence enforcement disabled, two model iterations, 16,384 output tokens/call, causal rendering, 48-node ceiling, 16K working target and 64K hard estimated prompt ceiling. Query is `As of <date>, <question>`. Main HTTP deadline 180s; whole arm 400s. The benchmark concerns recalled conversation content, not independent verification of claims in those conversations.

Native and lexical share the same up-to-64-window BM25 pool, up-to-12-window packing, at most two non-overlapping windows per source, exact UTF-16 spans, current-version filtering, compiler and budgets. Native uses `jev-1.13.0` and a 15s deadline. Jev supplies usefulness judgments, not truth or permission. The post-development continuity guard retains the preceding request/answer and up to four direct current-goal parents under the same budgets; imported benchmark sources have no prior conversational frontier. The guard has separate deterministic tests, not a claim of natural-history efficacy.

Cases sort by opaque ID; starting arm rotates standard→lexical→native by case index. One serial worker; at least 15s between main dispatch starts. No transport retry or failed-arm rescue. Model action repair may consume the second already-budgeted iteration. Maximum 1,176 main and 196 Jev starts. A fixed eight-hour outer timeout applies. Stop only for that bound, explicit human stop, credential rejection, model-identity mismatch, evidence-integrity failure, or host/security emergency—not observed scores. An interrupted cohort is inconclusive and must not be silently restarted.

`confirm.mjs` validates sealed participant/runtime/protocol hashes before dispatch and creates an exclusive persistent `/data/native-recall-v1-confirmation-started.json` receipt. Never remove it to replay. Its separate `--offline` mode uses no providers, labels every artifact simulated, injects a rate-limit failure and a Jev fallback, and cannot be scored as confirmation. Development runner and historical evidence remain separate.

Vendor model names are pinned and returned identities recorded; underlying vendor weights cannot be independently frozen or verified. No ordinary lab redeployment, historical Infinite/SDK-build execution, or commercial product change is part of this study.

## Blind scoring

After all generation terminates, use the frozen isolated Pi judge: `openai-codex/gpt-5.6-sol`, low reasoning, no tools/extensions/skills/context files/templates/themes/persistent session, explicit system and blank append prompt. Require the same 32-decision synthetic calibration before scoring. Two independent calls per case reverse anonymous response order. No model or arm metadata is shown. Every response is judged independently against the question, reference and existing official-style category rubric.

**Primary correctness:** an arm must complete and both judges must say correct. Generation failure is zero. Judge disagreement is zero, reported separately. The established preference rubric permits useful partial personalization; it does not require every preference point. Temporal off-by-one tolerance remains unchanged. Gold ambiguity and stricter source-fidelity interpretations are diagnostic sensitivities, never a post-hoc replacement primary endpoint.

No external judge invocation replay. Completed caches bind the exact question/reference/replies/rubric/model; unresolved starts cannot replay. Native Pi retries, if exposed, are preserved and counted, with unknown failed-attempt usage disclosed. A failed calibration or unresolved/malformed judge call makes confirmation incomplete, not a favorable exclusion. Preserve original answers, raw visible judge text, both mappings and reasons. The scorer reconstructs packet hashes and verifies parsed votes against preserved provider text.

## Statistical and practical gate

Compare native separately with each control using case-level binary paired differences. Report paired mean difference, paired t with n−1 df, its two-sided p, exact two-sided McNemar/binomial p, and 10,000 group-stratified bootstrap percentile 95% intervals with seed 20260927. Apply Holm correction to the two exact McNemar p values. These exact tests—not whichever test looks better—determine the primary p criterion.

All conditions must pass:

1. Native accuracy gain **≥10 percentage points over each control** on all 196 planned cases.
2. Each paired **t ≥2.5**, each Holm-adjusted exact **p <.05**, and each paired 95% CI has lower bound **>0**. A null t from zero observed variance does not automatically pass.
3. On the explicitly selected all-three-arms-complete sensitivity subset, each accuracy gain also remains **≥10 percentage points**. On the 176 non-preference cases (still failure-zero), each gain must also be **≥10 percentage points**, so lenient partial-personalization wins alone cannot establish substantial factual improvement. Neither subset replaces the primary population; no additional significance claim is selected from them.
4. Native's abstention-correct count is **not below either control**.
5. Each arm completes **≥98%** of planned cases; native recall fallback rate is **≤5%** of all planned native turns. Fallbacks stay in every primary calculation; their usage may be unknown.
6. Zero detected source mutation, invalid span/provenance, action/read-set mismatch, credential disclosure, accepted wrong-model result, undeclared network/tool action, or prompt/node ceiling violation. Audit all returned successful states and available failed committed states. Do not certify missing failed provisional state. All claimed visible excerpts must actually be visible; nomination alone is insufficient.
7. The complete frozen cohort, judge and integrity audit finish, and all frozen identities/hashes match.

Passing numeric tests without the practical, reliability and safety conditions does not pass the adoption gate. A pass permits a narrowly scoped evidence conclusion and a review proposal, not automatic merging or deployment.

## Power and stopping

N=196 was sealed before development outcomes and will not be resized. `power.py` / `power.json` give a fixed-seed 100,000-draw planning sensitivity for true gains of 10/15/20 pp and discordance .30/.50. They conservatively require p<.025 for each comparison plus t≥2.5 and observed gain≥10 pp. The union-bound joint lower bound assumes neither independence between controls nor a favorable correlation. CI, abstention, complete-case, non-preference and operational gates are not simulated, so overall adoption power is lower. At the 10 pp practical boundary, requiring an observed gain of at least 10 pp necessarily limits power. Do not turn a wide interval or failed test into a larger or repeated cohort.

## Accounting and attribution

Persist every start, bounded response/error, original final answer, state and exact model prompt; do not persist authorization headers or hidden thinking. A start is not proof of provider receipt. Unknown usage is not zero. Include failed/malformed/fallback attempts, separate main/Jev/judge/calibration cost, and report returned model identities and peak reported input. Wall time includes deliberate throttling; do not present it as a product-latency benchmark.

Audit candidate coverage, exact spans, immutable prefixes and compiled read sets independently of correctness. Preserve literal prompt hashes and compare visible span sets separately: wall-clock cluster-label ties may change non-evidence text even when selections match. Report wins with byte-identical or source-equivalent input as such, not proof of recovered evidence. Inspect wins and losses, including weak preference matches and planned-versus-completed ambiguities, without rewriting scores. Archive all artifacts and checksum/credential-scan them before publication. A generation-byte-bound scan against the configured main/Jev credentials is required before any held-out judge calls; a second generation-and-judgment-byte-bound Pi-auth scan is required before final scoring/publication. These exact-value/raw-base64 scans are not a claim of detecting every possible secret. Account for known HTTP status even when a body could not be captured; malformed/missing usage is unknown.
