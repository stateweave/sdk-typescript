# Native recall — development plan, not a positive result

User authorization: make Jev automatic in ordinary Agents, require explicit server-side credential setup, and improve genuine performance toward t ≥ 2.5 and p < .05. Missing credentials must fail clearly. Temporary service failure must remain visible and preserve immutable state. No API enabling flag is part of the candidate.

## Hypothesis

The prior focus experiments nominated short node prefixes. Native recall instead finds exact interior source spans across current graph versions, asks Jev whether each span contains useful evidence for the actual task, and compiles the selected original IDs with their original text. The probabilistic judgment is a retrieval aid, never a fact validator, permission decision, correction, or deletion. All original nodes remain unchanged. A deterministic BM25 span-retrieval ablation receives exactly the same indexing, source packing and compiler capabilities.

Development compares three predeclared question designs: indexed Noul (shared candidate state, as in earlier integrations), direct Noul (query in shared state, the individual original excerpt in structured question instructions), and direct Score (four explicit evidence-usefulness levels). Code performs identity validation, ranking, overlap removal and bounded packing. No design can generate missing facts. Retrieval diagnostics are not answer-quality results.

## Data boundary

Source: the full-context `longmemeval_s_cleaned.json` from xiaowu0162/longmemeval-cleaned, SHA-256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`. This is a filtered SDK experiment, not an official LongMemEval leaderboard run. Each original history has roughly 455–514K content characters and 38–62 sessions.

Exclude all previously tested question families and normalized answer-session identities from the 32-case oracle pilot. Build support-connected components before selecting anything. Choose one question per component, using a fixed hash order, and separate 28 development cases (four per category) from 196 held-out cases (16 abstentions, 20 preference, 32 each in the other five categories). A structural attempt to reserve 20 held-out abstentions found only 17 available after reserving four development cases; before any provider call or outcome, the target was fixed to 16. No case has been removed based on model outcomes.

Remove every selected case's answer-bearing sessions from every *other* case's distractor history, as well as previous-pilot answer sessions. Preserve all of a case's own answer sessions. Thus answer-bearing sources are disjoint across development and held-out questions, including their distractors. Ordinary non-answer distractors may still overlap; disclose this and public-corpus/pretraining contamination. Original gold, categories, `answer_` IDs, abstention suffixes, source mappings and other annotations never enter participant inputs. Participant IDs are opaque hashes; original dates, roles and conversation text remain.

An initial unexecuted cohort snapshot did not yet remove cross-case answer sources from distractors. Preserve it separately; the corrected snapshot is `cohort-v2`. No provider has used either snapshot at the time this plan was written. Held-out answer files are not inspected during development.

## Development and calibration

1. Deterministic tests: exact spans/UTF-16 offsets, immutable source prefix, current versions, compiler budgets, actual visibility, privacy of credentials, required setup, cancellation, failed-run non-commit and reset generation.
2. Non-scored transport calibration: native model envelopes, pinned Jev response schemas, GLM visible/hidden output budget, timeout and sustainable serial request cadence. Preserve every start/response/failure; do not infer a quota dimension from HTTP 429/code 1302.
3. Evaluate the three question designs on the fixed 28-case development set. Preserve all variants and attempts. Inspect source recall separately from final-answer correctness, latency, usage and failures.
4. Improve only against development cases. If no substantial development advantage survives the lexical ablation, continue design work on development or report that it has not succeeded. Do not open the held-out answers to choose a design.

## Confirmatory boundary

Before any held-out provider call, freeze the final implementation, model settings, data/gold hashes, paired order, runner, blinded scoring, statistical unit, practical effect, budgets, exclusions and stopping policy in a separate protocol and Git commit. Planned controls are the existing SDK and the identical native pipeline with lexical ranking instead of Jev. The substantial-benefit target is ≥10 percentage points over each, t ≥2.5, multiplicity-controlled p <.05 and positive 95% paired confidence intervals, with prespecified operational and safety requirements. This is a target, not a guarantee. Keep all-attempt/failure-zero and completed-case sensitivity results, unknown usage, exact prompt no-ops and recovered-source visibility distinct.

Run the final held-out cohort once. Do not extend it, retry selected failures, switch endpoints, lower the effect threshold, or change the scorer after seeing its outcomes. A failed result remains failed. New hypotheses would require fresh independently sealed data and a new decision.

Nothing in this branch is merged, deployed or proven beneficial yet. Existing focus/change-review/quality-pilot results are unchanged.
