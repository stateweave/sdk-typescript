# GLM Flash / native Agent pilot: no validated win

**The current Agent did not beat the full-transcript control on this development episode.** Reducing the projection ceiling from 48 to 12 nodes passed the frozen development-selection rule, but validation was incomplete. No optimization was merged, deployed or promoted; historical scores and final-test episodes are untouched.

## Execution and coverage

- Protocol: `current-agent-native-ledger-pilot-v1-20261107`; participant/scorer freeze commit `19944ec1e2fd60844098881f20f8f0e0960bfb82`, before the first dispatch.
- Started **2026-11-07 13:49:45.561 UTC**; stopped at the frozen **45-minute in-container deadline**, exit **2**, status `deadline`.
- Completed calibration and both 60-turn development pairs: default 48-node graph and the 12-node candidate, each against a freshly reset full transcript on development seed `117701`.
- The 8-node second candidate was skipped: the conservative scheduler required 180 requests for it plus 180 reserved for validation.
- Selected 12 nodes. Validation seed `227701` completed **15 turns per arm**. Graph turn 16 began but its answering request did not return before termination; transcript turn 16 was never dispatched. No turns 41–60 were reached in validation.
- Final-test dispatches: **0**. There were no automatic retries or restarts.

The deadline was my operational choice, not a provider denial or exhaustion of the authorized request/token ceilings. I underestimated full-run wall time. The one-turn calibration verified wiring and basic envelopes, not sustained long-context/output-budget headroom. I did not extend the deadline after inspecting results.

## Frozen scores

Primary endpoint: final human-answer accuracy on **turns 41–60**. Full-episode accuracy is secondary. Protocol/output failures remain incorrect; internal graph contents never earn answer credit.

| Development configuration | Graph late accuracy | Full transcript late accuracy | Graph full episode | Full transcript full episode |
| --- | ---: | ---: | ---: | ---: |
| Default: 48 nodes | **1/20 (5%)** | **8/20 (40%)** | 17/60 | 33/60 |
| Candidate: 12 nodes | **3/20 (15%)** | **9/20 (45%)** | 21/60 | 38/60 |

The candidate was selected because late correct answers increased, with no additional graph protocol failures: **37/60 in each development round**. This is development selection, not independent confirmation. The repeated transcript control also changed, despite temperature zero; candidate/default differences cannot be treated as an isolated causal effect.

Validation's primary endpoint is **unavailable**, not 0/20. On the first 15 completed turns only, graph answered 10 correctly and transcript 12; these are coverage/diagnostic counts, not a substitute endpoint or a completed held-out comparison.

## Requests, usage and latency

All provider API requests—including native retrieval, calibration, failed participants and the unfinished request—share the budget. Jev batches are not equated to answering generations.

| Provider | API requests | Returned responses with usage | Input tokens including cache | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| Z.ai `glm-5.3-flash` | 273 | 272 | 950,182 | 164,710 |
| TypeSafe `jev-1.13.0` | 118 | 118 | 888,522 | 70,994 |
| **Total** | **391 / 600** | **390** | **1,838,704** | **235,704** |

- **Known provider tokens: 2,074,408.** One unreturned Z.ai request (validation graph turn 16, request 391) retains a **17,850-token reservation**. Known usage plus the unresolved reservation is **2,092,258 / 3,000,000**. Actual usage of the unreturned request is unknown, not zero; the reservation is not a billing receipt.
- The runner's `unknownUsageCalls: 0` counts returned responses with unusable usage, **not** outstanding requests. `results.json.unreturned` explicitly records the outstanding request.
- Native requests contained **3,983 classifier questions** in total. All their provider-reported tokens above are charged. This is a whole-system graph+retrieval comparison, not matched total calls, cost, or a single-model storage-format experiment.
- Served model names in every returned response matched the configured names. Provider weights are not independently fingerprinted. GLM's observed output maximum was **1,024**; Jev's was **894**. Jev lacks an equivalent provider-enforced output cap: its conservative reservations are not a mathematical guarantee against arbitrary provider behavior.
- No dollar-cost estimate is made: token prices differ by provider and were not verified.

| Completed development round | Graph API requests / total tokens | Transcript requests / total tokens | Mean graph turn | Mean transcript turn |
| --- | ---: | ---: | ---: | ---: |
| 48 nodes | 113 / 772,655 | 60 / 185,759 | 13.67 s | 7.10 s |
| 12 nodes | 115 / 785,697 | 60 / 183,206 | 13.31 s | 5.88 s |

The candidate did **not** reduce whole-system token usage: graph tokens increased about **1.7%**. Latency is descriptive end-to-end wall time under the observed service conditions, not a controlled performance claim.

## Failure mechanisms and measurement limitations

- The dominant operational problem was output exhaustion: each graph development round had **37 `max_tokens` responses and 37 protocol failures**. There were 28 empty visible graph responses in the default round and 37 in the candidate round. Hidden reasoning is not published, but its reported output-token consumption is charged.
- The current SDK commits graph state only after a successful run. A malformed/truncated graph action can therefore lose that turn's update, affecting subsequent queries. The transcript deliberately retains every user input and raw assistant response, including malformed responses; its history was not silently repaired or truncated.
- This is one repeated development episode and one **incomplete** validation episode. There is no defensible population-superiority claim, meaningful episode-level confidence interval, or confirmatory tuning effect. No turn-level p-values are used as if turns were independent episodes.
- A separate Python reducer reproduced **all 60 development oracle answers**, with no mismatches. This was an independent implementation, **not a source-blind task validation**.
- Participant instructions were too terse about some domain rules. In particular, `revoke` sets `active=false` while retaining owner/quota in the oracle, but that behavior was not explicitly spelled out in the task text. At development turn 12, the frozen gold is `false`; interpreting revocation as deletion instead would yield `null`. This moderate under-specification limits the quality interpretation. No cases were excluded or silently regraded after discovery.
- Join arrays are compared after canonical sorting: membership/types are checked, but the requested sorted presentation is not independently enforced. This should be clarified, not retrospectively changed.
- A selected-graph-versus-transcript validation, even if complete, would not directly compare the candidate against the default graph on held-out data.

## Evidence and checks

**Source:** reviewed current-public-Agent revision `bcf490a5231cba70ba316578e24ceb26762d83d9`. All **32** pinned deployed JavaScript files match normalized ES2022 transpilation of that revision (TypeScript **5.9.3**); comments/formatting are excluded in this source check. Deployment bytes are separately pinned by `runtime-lock.json`.

**Runtime:** actual execution Node **22.23.4**; offline integration Node **22.22.1**. The SDK was imported without importing/starting the web server. No deployed runtime files were changed.

**Live:** the archived sanitized receipt contains 391 pre-dispatch records, 390 response records, model-visible text, native rankings, exposed state deltas and outcomes. Credential-byte scanning of all four receipt/log files passed inside the configured environment. Hidden-thinking blocks and authorization headers were not archived.

Offline verification:

```sh
./node_modules/.bin/vitest run tests/pairedLedger.test.ts
PILOT_TEST_SDK=/path/to/copied/dist node --test tests/pairedLedgerRunner.node.mjs
./node_modules/.bin/tsc --noEmit
node scripts/paired-ledger/verify-runtime.mjs /path/to/reviewed/src /path/to/copied/dist source-parity.json
node scripts/paired-ledger/analyze.mjs /path/to/terminated/receipt-directory
```

- **30 oracle tests + 15 runner tests pass**, including fully mocked HTTP against the actual compiled SDK. These tests are not paid quality evidence.
- **35 reconstruction checks pass**: frozen participant/scorer hashes, response identities, known and unresolved usage, model identities/GLM caps, no final-test dispatch, final-only scoring, completed-cohort totals and frozen selection replay.
- Derived evidence: [`results.json`](./results.json), [`runtime-source-parity.json`](./runtime-source-parity.json).
- Original report SHA-256: `e7c294a4c75abc2a73fbc1d30395793c529663d96ae6918d8a4efe94ce7f2dbf`.
- Original event ledger SHA-256: `ee953d58b09db12ec66bae15ed71f8e63a953cc526c1520e92b5068242cd8843`.

## Decision

**Do not promote this configuration or claim a validated improvement.** Before another paid experiment: explicitly define event semantics, independently validate participant instructions, calibrate realistic multi-turn output/wall-time behavior, and reserve validation time as well as requests/tokens. Any revised protocol or continuation requires explicit authority; no retry, backfill or additional inference was launched.
