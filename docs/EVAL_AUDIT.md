# Offline eval audit and Hill Climb fit

## Decision and boundaries

**The existing graders fail offline negative controls. Do not use their scores to start a hill-climb or claim graph-memory superiority.**

Approved scope is offline validation and documentation. Paid runs, retries, backfills, deployment, and an autonomous optimization loop are not approved. The eventual model-selection plan is to use the existing configured model for both participants, not switch providers. Its actual served model ID, repetition count, and spending ceiling remain unverified/unapproved; source defaults are not evidence of live configuration.

This change adds an audit, not a new grader or a benchmark implementation. No production grading logic, frozen protocol, historical score, or dataset is changed.

## Revisions and reproducible results

The checkout used in the initial investigation was development commit `dd24d25`. Before documenting the findings, both remote branch heads were refreshed and inspected:

| Source revision | What exists there | Offline controls |
| --- | --- | --- |
| [`main` at `8d11c60`](https://github.com/stateweave/sdk-typescript/tree/8d11c609c0c5fc780be53b91a5d4cc2437be5802) | Small GraphFrame SDK and toy CLI eval; no web grader | 4 pass, **2 fail**; web unavailable |
| [`development` at `bcf490a`](https://github.com/stateweave/sdk-typescript/tree/bcf490a5231cba70ba316578e24ceb26762d83d9) | Toy CLI, historical GraphFrame/web comparisons, newer causal-agent/benchmark work | 7 pass, **6 fail** |

[Raw control results](./eval-audit-results.json) include exact revisions, source SHA-256 hashes, expected/actual values, and unavailable components. Those results are synthetic fixtures, not model-quality measurements. They do not establish the current deployment revision or invalidate every older benchmark.

### Run without a model or server

```sh
pnpm eval:audit
pnpm eval:audit --source-root /path/to/pinned-sdk-checkout
```

If `pnpm` is not on PATH, use existing local dependencies:

```sh
./node_modules/.bin/tsx scripts/audit-eval-graders.ts
./node_modules/.bin/tsx scripts/audit-eval-graders.ts --source-root /path/to/pinned-sdk-checkout
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
```

The source checkout must already be present. The audit never fetches it. To reproduce the development snapshot, use an isolated checkout at the full revision in the table. Run the audit script from this branch, passing that checkout as `--source-root`.

Exit codes: **0** = available controls pass; **1** = behavioral controls failed; **2** = audit setup/extraction failed. Missing web code is explicitly unavailable, never validated. The recorded snapshots intentionally exit **1**. Do not add this command as a passing CI gate before resolving the findings in a separately versioned grading change.

The script selects named pure function declarations with the TypeScript parser, transpiles those declarations only, and evaluates synchronous calls with a timeout. It does not import the target module, load `.env`, instantiate a provider, start the web server, or resume stored runs. A test checks that top-level initialization and imports are not executed. This is for trusted repository source; Node's VM is not a security boundary for hostile code. Extraction/setup failures are not scored as participant failures.

The normal unit tests validate the audit machinery, including good and broken fake graders and parity with the real toy grader. Verification for this change: **13 tests across three files passed**, `tsc --noEmit` passed, and the SDK build typecheck (`tsc -p tsconfig.build.json`) passed. Passing unit tests therefore do **not** mean the audited graders are sound.

## Verified grader findings

Paths below are relative to the repository; development line references are pinned to `bcf490a`.

### High: internal graph facts can pass a wrong or empty final answer

`src/evals/judge.ts:13-18` concatenates `finalAnswer` with the internal graph and checks expected substrings. On both revisions:

- Correct final answer: passes.
- Empty or unrelated final answer without graph facts: fails.
- **Empty or unrelated final answer with expected facts only in graph state: passes.**

This is representation-dependent grading. Only the graph arm has meaningful internal graph contents. The `calledTool` flag is diagnostic, not a requirement for success. Three keyword-based toy tasks are smoke fixtures, not a calibrated memory benchmark.

Recommendation: grade final answers or environment outcomes using an independent oracle; report graph validity and mechanism engagement separately. Preserve the old scorer and results as historical evidence when introducing a corrected scorer.

### High: web `BOTH` is parsed as `B`

`src/web/server.ts:1708-1712` uses `(A|B|BOTH|NEITHER)`. JavaScript matches `B` before `BOTH`. The audit invokes the actual extracted parser, not a copied regex:

```text
WINNER: BOTH -> b        (expected both)
WINNER: BANANA -> b      (expected unscored parse error)
```

Recommendation: parse complete labels with an exact boundary, then test all four labels plus malformed/prefix cases. Anonymous A/B assignment does not repair incorrect votes.

### High: invalid or corrected judgments can manufacture scores

- `src/web/server.ts:1712`: malformed text becomes `neither`, confusing grader failure with both participants being wrong.
- `src/web/server.ts:1715-1722`: a one-sided vote on equivalent answers becomes `both`, even when both say `scarlet` and gold is `azure`.

Recommendation: invalid judgment is unscored `grader_error`; equivalent answers still require correctness verification. Add identical-wrong and null controls before trusting any LLM judge.

## Other source-audit observations

These are code observations, not paid-run or live-runtime reproductions:

| Surface | Observation | Consequence / next step |
| --- | --- | --- |
| Historical web comparison, `src/web/server.ts:870-875,1075` | Transcript arm gets one completion; graph arm gets tools and up to five iterations | A whole-system comparison, not state representation alone; equalize capabilities in a new protocol |
| Web worker, `src/web/server.ts:1077-1078` | Both memories advance before grading succeeds | Persist a pending-grade checkpoint or roll back; retry grading without replaying participant turns |
| Legacy replay, `src/evals/infiniteReplay.ts:87-88,118,127` | Fresh candidate versus stored baseline grade; answer clipped to 1,500 characters; judge errors become fail | Historical diagnostic only; new paired runs need contemporaneous baselines and separate grading errors |
| `ModelOutput` and complete adapter | Complete results lack required served-model and stop-reason fields | Record actual served identity/termination before any quality or cost claim |

The Infinite v8 harness already provides useful frozen corpus/version checks, isolated workspaces, matched nominal budgets, order-reversed blind judges, paired rollback on external provider failures, per-turn archives, and scenario-level statistics. Retain these strengths; do not attribute its outcomes to defects found in a different web-grader path. Its generated evidence, tools and LLM judges make it a broader system evaluation.

This is not a complete audit of newer Jev, Codex-cost, or one-shot benchmark suites on `development`. Their existence is not evidence that the historical web or toy graders are repaired.

## Confirmed graph-state versus message-history proposal

**Question:** At a matched model-call and context budget, does graph memory preserve current facts more reliably than full message history over a long conversation?

- **Task:** synthetic evolving ledgers with novel entities, corrections, revocations, ordering and joins. Generate fresh versioned episodes; do not reuse an exposed or frozen held-out corpus.
- **Participants:** graph state versus a strong full transcript retaining available history. Same provider/model snapshot, task-level policy, requests, sampling, context/output limits and one participant generation per turn. No tools, workers, free repair calls, or arbitrary twelve-message truncation. Any later permitted compaction/repair is explicitly budgeted and counted.
- **Pilot size:** 30 independent 60-turn episodes, with ten development, ten validation and ten untouched final-test episodes. Split whole episodes with fresh state, distinct seeds and entity namespaces. This does not establish statistical power; repetitions and confirmatory size must be chosen from measured variance before final-test access.
- **Grading:** independent deterministic event-reducer oracle and normalized structured answers, not an LLM judge. Offline oracle, null, stale-answer and graph-only controls must behave correctly first.
- **Primary metric:** per-episode accuracy on the final third of turns. Report full-episode/category accuracy, participant cost and latency separately, with paired episode-level uncertainty. Serial turns are not independent samples.
- **Errors:** agent/protocol failures remain explicit outcomes; serving/harness failures are unscored attempts, with coverage and failure rates shown. Predeclare incomplete-pair, overflow and invalid-run rules; never silently remove inconvenient failures.
- **Evidence:** same-call raw requests/responses, compiled state or transcript, parsed output, oracle grade, actual served model where exposed, stop reason, provider/cache usage, retries and timing. Randomize paired execution order.

### Important revision distinction

The confirmed original graph arm was `GraphFrame -> GraphOps -> StateGraph`. It measures the historical GraphFrame protocol at these revisions.

Current `development/AGENTS.md` says the public `Agent` instead uses an immutable causal graph, deterministic bounded context, ordinary actions, and runtime-authored lineage. GraphOps is historical/internal there. **Do not restore the old public runtime or claim that a GraphOps benchmark measures today's public Agent.**

Before implementing or executing a new comparison, name and pin the graph arm explicitly: retain the confirmed historical GraphFrame question, or obtain an amended scope targeting the current causal `Agent`. Source identification is complete; that experimental-arm decision remains open. No runtime migration is part of this audit.

## Where `/claude-api hillclimb` fits

Official sources:

- [Hill-Climbing on an Eval](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/evals/eval-hillclimb.md)
- [Eval health checklist](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/evals/eval-audit.md)
- [Build an eval](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/evals/build-eval.md)

These are external methodology references, not runtime dependencies or authorization to execute their workflows. The checked guidance was consulted on 2026-11-07; upstream `main` links can change.

**Useful after measurement is sound:** inspect development failures, make one hypothesis-driven change per round, record its patch and traces, check the effect against noise/headroom, and retain changes based on validation. Pin runner, grading policy, model and corpus. Use a final test untouched by both tuning and round selection.

**Do not copy blindly:** Claude-only model defaults, Claude Code tool commands, or instructions to overwrite baseline grades conflict with a provider-neutral frozen-evidence project. Corrected grades must be separately versioned derived analyses. Keep baseline tuning effort explicit rather than tuning only the graph arm and presenting that as an architectural win.

### Gates before a paid hill-climb

1. Resolve and version grader defects; pass oracle/null/wiring controls without network access.
2. Resolve historical GraphFrame versus current causal-agent scope and implement a matched runner.
3. Verify the existing configured model without exposing credentials; record a served snapshot during an explicitly approved smoke run, not from a source default.
4. Approve fixtures, metric, allowed change paths, practical effect size, error/overflow rules, repetitions, maximum rounds and total spend.
5. Measure baseline variance/headroom and recheck the planned experiment's resolution before a full paid pass.
6. Tune on development; select with validation; confirm baseline versus winner once on the untouched test. Preserve all frozen evidence, including negative and inconclusive outcomes.

At present the measurement gate fails, no paid smoke call is approved, and the hill-climb has not started.
