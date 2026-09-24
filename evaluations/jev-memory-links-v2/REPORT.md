# A better Jev candidate: semantic links when memory is stored

**Recommendation: pursue an opt-in semantic memory index, not more query-time reranking.** A prototype improves unique evidence coverage in deliberately duplicate-heavy graphs. It is not deployed, does not change defaults, and is not evidence that the SDK is generally much better.

## The graph problem

Current StateWeave supersedes semantic memory by exact `semantic:<type>:<key>`. Different generated keys can therefore retain the same fact multiple times. All those copies can compete for the bounded working context. Relevance reranking does not fix that: every duplicate really is relevant.

Use Jev to recognize a narrow relationship between candidate memories: **same complete fact**, **directly incompatible**, or **uncertain/neither**. Keep those judgments in a derived index, separate from causal parents. A same-fact link allows one existing source node to represent another in optional context selection. All original nodes, keys, content and provenance remain immutable. Contradictions must retain both claims; Jev does not decide which is true or whether a later record is an authorized correction.

Intended pipeline: new semantic memory → cheap exact check → bounded semantic comparisons → cached advisory links → deterministic projection. Do not rescore the same immutable pair for every user question. This experiment supplies candidate pairs; automatic candidate discovery and ingestion are still future work.

## Fresh-case result

An initial overly strict gate failed and is preserved below. After that calibration, we froze a new policy and **32 fresh cases before calling the provider**. No cases, prompts or thresholds changed after the fresh outputs. Jev was pinned to `jev-1.13.0`.

| Fresh-case endpoint | Exact text | Exact + Jev |
|---|---:|---:|
| Equivalent pairs recognized | 2/16 | 15/16 |
| Non-equivalent pairs incorrectly collapsed | 0/16 | 0/16 |

The missed equivalent was weekday-only support versus Monday-through-Friday-only support (`h09`). The prototype conservatively kept both statements. This particular pair depends on ordinary English weekday convention; the hand-authored gold set is not a substitute for external annotation.

There were also two high-confidence conflict flags out of three direct contradictions, with zero false conflict flags among the other 29 pairs. Conflict flags were recorded, **not used to change the graph or resolve the task**.

The final equivalence policy is an exact-text match OR Noul equivalence >= .90 with incompatibility <= .10. These probabilities are not a guarantee of correctness. Conflict flagging remains >= .97 incompatibility and <= .03 equivalence.

## Actual Agent runs: more distinct facts in the same context

All nine runs used the real `Agent`, GLM `glm-5.3-flash`, temperature 0, 4096 output tokens, identical initial states and prompts within each fixture, no tools, a 16K working target and 64K ceiling. All completed in one model call, preserved all original nodes byte-for-byte, and recorded exactly the visible read set as final-answer parents.

| Stress fixture | Node ceiling | Facts available | Current SDK | Exact dedup | Exact + Jev |
|---|---:|---:|---:|---:|---:|
| Lumen | 10 | 8 | 5 | 6 | **8** |
| Harbor | 10 | 8 | 5 | 5 | **8** |
| Combined | 16 | 16 | 9 | 9 | **13** |

Values are **distinct source fact families in the final model-call context**, not answer-accuracy scores. In the combined graph this is 44% more distinct facts under the same 16-node ceiling, not a 44% accuracy or general-productivity gain. The three fixtures share pairs and are not independent observations.

The [unedited final answers](ANSWERS.md) visibly reflect the broader context. For example, the Lumen baseline omitted approval, maintenance duration and retention; Jev's answer included them. In the combined case Jev surfaced four additional Lumen facts. It still did **not** recover all 16 facts. Several responses also overstate completeness despite seeing only a projection; wider answer correctness and calibrated uncertainty need their own evaluation.

The result is coverage/diversity, not proven compression or speed: provider input for the combined task was 1,391 tokens for either control and 1,398 for Jev. Nine single observations cannot establish latency differences. Complete timings and input/output tokens are in [summary.json](summary.json).

## Cost and reuse

The complete 32-pair classification pass cost **10,414 input / 1,112 output Jev tokens**, six batch requests and **1.408 seconds summed measured request time**. This includes safety controls that are not used in the positive pressure graphs, and exact matches that a production implementation could bypass. The subsequent nine graph queries made no Jev calls; they reused the frozen index. This does not measure ingestion latency at scale, all-pairs discovery cost, amortized real-workload costs or dollar savings.

## Preserve the failed first policy

[V1](../jev-memory-links-v1/PROTOCOL.md) used .97 equivalence and <= .03 incompatibility. It recognized **1/12** equivalents, versus **2/12** with exact matching, and did not improve graph coverage. It flagged 5/13 contradictions without a false flag but missed eight. Those thresholds were too restrictive on this calibration set. V1 was not rerun or relabeled as a success; [its full summary](../jev-memory-links-v1/summary.json) and raw evidence remain intact. V2's .90/.10 policy was chosen after seeing that calibration, then frozen before the fresh cases.

## Prototype safeguards and status

The branch introduces optional source-ID-bound `semanticAliases` for `CausalWeave.compile` and `Agent`, with no default behavior change. The supplied aliases are caller-approved **projection hints**, not provider-authorized mutations. The experimental Jev adapter lives only alongside the evaluation, not as a promoted SDK export or a Dev UI feature.

- Only current semantic nodes of matching types may be represented by a newer current node. Stale/superseded targets are ignored, never followed to a replacement value.
- Mandatory frontier and current-turn evidence cannot be hidden. Source/resource keys, graph identity, state format, validation and successful-run commits are unchanged.
- Alias chains and duplicate source bindings fail closed; no transitive clustering occurs. Node and token limits remain authoritative.
- Post-run unit hardening preserves explicit focus preferences and query access through either wording. Obvious quotation/history/provenance questions bypass aliases. This lexical bypass is not a complete multilingual intent detector: callers must disable the option for exact wording, history or authority-sensitive work. It received software tests only; the frozen live evidence was not rerun or overwritten.
- Original graphs and the existing browser graph view are unchanged. A collapsed semantic display, durable per-session index, changed-authority handling, automatic candidate discovery, timeout/fallback integration and applied-link observability at the application boundary remain unimplemented.

**Do not merge or enable this by default yet.** Zero false links on 16 chosen negative controls cannot establish a safe real-world false-suppression rate. Before promotion, evaluate automatically discovered candidates on independent natural histories, including ambiguous identities, partial entailment, numerical conditions, source authority, negation, multilingual text, corrections and exact-quotation tasks. Compare with stronger safe deterministic baselines as well. A deployment needs a reversible opt-in, clear link diagnostics and source expansion.

## Software verification

277 tests passed, along with SDK/web typechecks, SDK build, package validation and `git diff --check`. Disabled compilation matched the deployed baseline byte-for-byte on all three fresh fixtures. Post-run safety changes were tested without repeating provider inference.

```sh
pnpm typecheck
pnpm web:check
pnpm test --maxWorkers=1 --minWorkers=1
pnpm build
pnpm package:check
```

## Frozen evidence

- Runtime/protocol V1 commit: `945961d9ef669439bf47bfdaa5fdd7c31f98075e`.
- V2 frozen commit: `ac4ebd4fb408d8692ca5b2f530488adc355425dc`.
- V1 fixture SHA-256: `f00ccd5eadf2ae452e57e3c7073ffcdbd02e3c12c96edee07ab78764f578442b`.
- V2 fixture SHA-256: `42e1f5354b6dc8f6883be110df5262fdcac3223704601c8673404405bdf9336d`.
- [V1 complete evidence](../jev-memory-links-v1/evidence/strict-calibration.tar.gz): SHA-256 `fd38f945e240209fd373a41051fcf125a6cc6b242f28c75618edc2cb9fc8adf6`.
- [V2 complete evidence](evidence/fresh-validation.tar.gz): SHA-256 `e05515d49a4c3203a39f1883ae369a017e5a33158f656c9eda863eb0be59b4b4`.

Each archive contains all starts, provider responses, judgments, summaries, source states, full Agent results and exact read sets. The fixed archive is synthetic and credential-free. Replay aggregation without a provider:

```sh
mkdir -p /tmp/jev-memory-report
tar -xzf evaluations/jev-memory-links-v2/evidence/fresh-validation.tar.gz -C /tmp/jev-memory-report
node evaluations/jev-memory-links-v2/summarize.mjs /tmp/jev-memory-report/jev-memory-links-v2-results-20260924
```

The public app, its persisted chats, existing focus settings, commercial StateWeave, Infinite and SDK-build were not modified or invoked by these probes.
