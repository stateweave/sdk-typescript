# Jev focus pilot v1 — frozen before provider execution

Fixture SHA-256: `1383bb9de5b180598ea2e76d9e0e275129f5c7a3f4f3890dbfa0015d1d9d02e4`.

This is a 12-case engineering pilot, not a powered generalization study. No prior model outputs informed these cases. All cases run once; do not extend, replace, drop or rewrite cases to improve results. The preregistration commit pins the runner, fixture, scoring, prompts, and implementation. A code correction after execution requires a separate disclosed protocol, not an overwritten result.

## Arms and matching

1. Deterministic current compiler, no sidecar.
2. Flat Jev: at most 24 candidates, up to six preferences.
3. Hierarchical Jev: at most 16 topics, three nominated branches, 12 subgraphs, four nominated leaves, then 24 atoms including eight global bypass candidates, up to six preferences.

All three use the same compiled SDK, immutable 217-node starting snapshot (72 synthetic recorded turns), current version semantics, scoped native read_file tool, prompt, model `glm-5.3-flash`, temperature 0, output ceiling 1024, five-iteration allowance, molecular mode, 16 selected nodes, 16K working target and 64K hard prompt ceiling. Jev is pinned to `jev-1.13.0`; thresholds are 0.5, not tuned on this corpus. All three receive identical `probe.txt` content. Workspace roots are isolated and normalized out of tool descriptions. Model read-set parents must equal actual compiled IDs. No gold fields, case category, scorer, other arm, or benchmark identity enter participants' state or tools. The presence of source fact codes is intentional task data, not hidden evaluator labels.

Each case rotates arm order by its index to distribute time/cache bias. No concurrency. Per-turn wall deadline: 120 seconds. SDK sidecar deadlines: five seconds flat, ten seconds hierarchical across all calls. No API retries. A sidecar timeout/failure's deterministic fallback is scored as delivered behavior, with partial known overhead and unknown additional usage disclosed.

## Primary endpoint

Full pass requires all of:
- valid JSON with `answer` and `probe` strings;
- all expected case-insensitive answer substrings, no forbidden stale values;
- probe marker copied correctly after a native read_file call;
- that actual tool result visible in the final model read set;
- all non-superseded required semantic evidence nodes visible in that read set;
- unchanged original nodes, exact answer read-set parents, and every compiled prompt within 16 source nodes / 64K estimated prompt tokens.

This is intentionally stricter than answer correctness. Report both. An answer can be correct via a visible overview or chance while failing the evidence endpoint. UNKNOWN is the declared no-evidence case and has evidence recall 1 by convention. Free-form judge scoring is not used.

## Secondary endpoints

Per-case answer correctness; required-atom recall; candidate and stage scores; fallback rate; main-model input/output/peak context/call count; separate Jev input/output/call count/latency; complete wall latency. Report the full ledger, arithmetic means for recall, medians for latency, and total measured provider tokens. Do not silently exclude Jev overhead from an efficiency claim. Dollar cost is not asserted without dated provider rates; token and request overhead are measured directly. Query/group caps limit recall and are part of the tested design.

## Failure and analysis policy

A model/protocol/recursion/tool failure counts as failure. An unambiguous external answer-provider transport/auth/quota outage is marked operationally incomplete; show its raw bounded evidence and exclude its entire paired case from inference, never count it as a win for another arm. Preserve all attempted results. No model retry. Interrupted `.started.json` arms are not automatically replayed. `--resume` only skips finalized records and refuses to overwrite a started/unfinalized arm. This pilot may therefore end incomplete honestly.

Report exact two-sided paired sign-test p-values for hierarchical versus deterministic and flat on the full-pass indicator (ties excluded), with Holm adjustment across the two planned comparisons. With twelve designed cases the power is low; regardless of significance, this pilot cannot justify broad answer-quality claims. Keep the feature opt-in. Any confirmatory experiment needs an independent preregistered corpus and power plan. Inspect failures only after the fixed run ends.

## Separate release E2E

After deployment, exercise the actual Dev HTTP stream and paired session persistence, UI settings at desktop/mobile, and default-off behavior on disposable synthetic sessions. These are plumbing tests, not extra quality cases. Preserve the frozen Infinite and SDK-build evidence; never use their fixtures or sessions here.
