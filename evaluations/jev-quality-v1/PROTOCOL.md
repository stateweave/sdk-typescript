# Jev quality checkpoints — frozen pilot v1

## Question and decision

Do source-grounded memory promotion and evidence-sufficiency-triggered context recovery improve actual downstream answers, rather than only graph coverage?

Primary comparison: **combined versus baseline**. Grounding-only and recovery-only are explanatory ablations, not alternative primary hypotheses selected after results.

A large-gain signal requires all of: at least 30 eligible paired cases; at least **20 percentage points** higher correctness; exact two-sided paired McNemar/sign-test **p < .05**; no decrease on the abstention stratum; preserved source graph, node budget, and exact final-action read sets. This would justify a larger independent validation, not automatic SDK adoption. A null does not prove no smaller or long-horizon benefit. With only 32 cases, this is a large-effect screen, not an equivalence study or an official leaderboard submission.

## Independent public data

Source: [LongMemEval](https://github.com/xiaowu0162/LongMemEval), ICLR 2025, MIT; cleaned [oracle dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned). Preserve `LONGMEMEVAL_LICENSE`.

Downloaded oracle SHA-256: `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c`.

The oracle data contains evidence sessions, **not** the full S/M distractor history. Eligibility, decided before any provider call: at most 60,000 source-content characters, 96 source turns, and 75,000 serialized source-state characters. This admits 481/500 public cases (451 non-abstentions and all 30 abstentions), bounding requests while excluding the largest histories. It cannot establish full S/M retrieval performance. An unexecuted 24K-character draft selection was broadened before freeze or any provider response; no outcomes informed selection. Select four per six question types plus eight abstentions by ascending SHA-256 of `jev-quality-20260924:<question_id>`. Order by SHA-256 of `execution-order:<question_id>`. `prepare.py` is executable selection documentation. The selected 53 sessions do not overlap across cases.

- `cases.json`: `cdec87a7d7956b0fe61566a3619419c657ec2d90e74fe1760aede18d77f7e52a`.
- `private-gold.json`: `55f2e9c29b9f6e75e580294222bcfe422f5ed1d02fd935bfc159af534530af95`.

Sort sessions by supplied date and ID, with dates/turns/IDs kept aligned. Participant records retain only dates, opaque IDs, roles and content. Original IDs contain `answer_` annotations, so replace each with `source-` plus the first 16 hex characters of SHA-256(`jev-quality-source:<original ID>`); keep the original-ID map only in private scoring data. Remove `has_answer`, answer-session labels, question types, reference answers and abstention identities. The producer sees **only history, not the future question**. The answer agent sees the question and its date, never the gold or stratum. No participant tools are enabled.

## Four arms, same real SDK

Use SDK baseline `762c773185e6f7c33358d2c7195f53c39e20aed5`, with the opt-in `contextRecovery` prototype. Disabled behavior stays unchanged. No semantic aliases or focus reranker. One public `Agent`, molecular mode, 16 detail nodes, 16K working target, 64K hard ceiling, two model iterations, no tools. Completion-evidence mutation guards are disabled equally because these are question-answer tasks, not file-work tasks. GLM `glm-5.3-flash`, temperature 0, 4,096 maximum output tokens, 120-second answer deadline.

Import each original dialogue turn as its own immutable resource node. A single shared GLM call, blind to the future question, proposes at most eight ordinary memory/preference statements. Its source read set contains every imported original record plus its exact system instruction. Raw proposal output is preserved in the import trace. Use identical proposals for all four arms so random extraction differences cannot masquerade as Jev effects. This is a controlled **import → memory → later question** experiment, not a many-turn deployment or a test of automatic candidate discovery.

1. **Baseline:** all well-formed proposals become ordinary keyed semantic nodes.
2. **Grounding:** one Jev request compares each proposal against the complete original dated dialogue. Noul >= .80 promotes it. Otherwise retain the proposal as explicitly unverified verification evidence, not an active semantic fact. Keep originals unchanged. No destructive removal, replacement of authority, or graph rewiring. This importer-level experiment does not implement a production per-turn memory-review lifecycle.
3. **Recovery:** compile the usual projection first. Jev judges whether its visible evidence supports the entire question; if Noul < .80, score up to 96 unselected current resource/semantic nodes. At most six scores >= .70 become compile preferences. Recompile once under the **same** detail/token caps. No extra main-model call, no automatic answer generation, and no authoritative absence claim. Missing projected evidence is not evidence of graph-wide absence. All selected parents are still the actual final compiled source IDs.
4. **Combined:** grounding plus recovery.

Jev is pinned to `jev-1.13.0`; independent Noul questions are batched. All questions and thresholds are frozen in `checkpoints.mjs`. A 15-second request timeout, schema failure, invalid candidate ID or invalid recovery plan falls back to the ordinary graph/compiler. Cancellation propagates; no same-call automatic retry. Failed/rejected and partial responses remain evidence. Empty/malformed/failed extraction falls back to unchanged raw sources for all arms; report it rather than replacing the case.

Case-level arm order rotates Latin-square style; two independent case workers bound runtime. Shared extraction and grounding are physically called once per case and reused, with separate physical and logical per-arm accounting. Per-question latency includes recovery; report ingestion and grounding separately and also their sum with question time. No models, services, ordinary lab histories, or frozen Infinite/SDK-build artifacts are redeployed or modified.

## Blind scoring

Use isolated `openai-codex/gpt-5.6-sol`, low reasoning, no tools/extensions/skills/context files/templates/themes/saved session, explicit system prompt and explicitly empty append prompt. This is a separate model/provider from the GLM participant; no model fallback or harness-level replay. Native Pi may retry transport failures internally under its existing bounded settings; preserve exposed retry events separately rather than claiming one physical attempt. Pin and preserve the actual message model/provider and usage.

Four responses receive case-specific SHA-256-shuffled anonymous IDs and are independently assessed in one call against the public reference. `judge.py` adapts the official LongMemEval answer-checking rules: complete-equivalent answers; partial answers fail; knowledge updates may mention history while giving the correct updated answer; personalization follows its rubric; temporal counts tolerate the official off-by-one convention; abstentions must explicitly acknowledge the missing information. These are model-judged adapted scores, not official GPT-4o leaderboard scores. Empty/error outputs cannot pass even if the judge says otherwise.

A separate blinded call audits all proposed memories against original history, without the question, treatments, Jev probabilities, acceptance decisions, or answer results. This estimates false rejection/acceptance; it is not human-certified ground truth. Preserve concrete reasons and source quotations for audit.

Before scoring, two disjoint trivial calibration packets must pass all six binary decisions. Calibration is in the committed script. On a judge failure, malformed response or failed calibration, stop scoring; retain the attempt and do not silently retry, change models, relabel or replace cases. No outcome claims without a complete judge ledger.

## Statistics, failure policy and reporting

Fix 32 cases and 128 answer runs. Do not stop early, add cases, change prompts/thresholds, rerun variants, or tune after seeing responses. Case selection is not based on an SDK failure. Freeze all code, fixtures, scoring and this protocol in Git **before any provider call**, and record that commit plus file hashes in the result manifest.

Primary paired correctness excludes a whole case only if any answer arm has a transport/provider/deadline failure; internal action/recursion/invariant failures count as wrong. Also report an operational denominator of all 32, counting every failure as wrong. Jev fallback remains part of its assigned treatment. Judge failures block analysis rather than assigning convenient labels. Do not replace excluded cases. Report completion/fallback counts and partial usage. Report per-stratum totals and every answer/gold/reason, paired wins/losses/ties, exact two-sided McNemar p, and a seeded 10,000-resample case bootstrap interval (seed 20260924). Treat ablation p-values and intervals as descriptive; no multiplicity-adjusted efficacy claim from them.

Report actual main-model input/output, shared ingestion, physical Jev calls/input/output, and estimated Jev list-price dollars at $0.042/M input with free output. That is not an invoice or total-system cost. Money does not replace analysis of accuracy, latency, privacy, reliability or SDK complexity.

Known limits: public benchmark contamination is possible; shorter oracle histories omit realistic distractors; graph imports are not organic conversations; one future question per case does not measure many-turn hallucination propagation; extraction is shared for control rather than independently repeated; the small stratified sample is not a representative workload; judge errors and provider nondeterminism remain possible. A favorable result needs independent longer-history replication and a production lifecycle; an unfavorable result must be published unchanged.
