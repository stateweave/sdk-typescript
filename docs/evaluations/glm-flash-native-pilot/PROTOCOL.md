# Current Agent / GLM Flash: bounded native-recall pilot

## Human authority and amended scope

The human explicitly selected:

- Current public causal `Agent`, not historical GraphFrame/GraphOps.
- GLM 5.3 Flash, up to two candidate rounds and validation.
- At most **600 total provider inference requests** and **3,000,000 total provider tokens**.
- At most 1,024 GLM output tokens per request; no tools or automatic retries.
- Native Jev retrieval included, with its requests/tokens charged to the same ceilings.

This final choice amends the original matched-single-model experiment. The graph arm has a paid retrieval model; the transcript arm does not. This is a **whole-system configuration comparison**, not storage-format isolation, matched total call counts, or a test of historical GraphOps. No SDK deployment or benchmark promotion is authorized.

## Frozen implementation and policies

- Reviewed current SDK source: `bcf490a5231cba70ba316578e24ceb26762d83d9`.
- Execution imports only deployed compiled `agent`, `core`, `llm`, and `integrations` code, not the web server or historical eval initialization. A pre-call lock checks all 32 copied deployed JavaScript files in these trees, and the execution manifest records their hashes and the Node version. Those hashes identify the actual executed build; a reviewed source revision is not by itself deployment provenance.
- Answering model: Z.ai `glm-5.3-flash` through its Anthropic-compatible endpoint; temperature zero. Actual served identity and provider usage must be recorded for every response.
- Native recall: TypeSafe `jev-1.13.0`, using the SDK's actual bounded recall implementation. No focus reranker or tool layer.
- SDK `Agent`: `maxIterations: 1`, `tools: []`, causal context, 16K projection target, 64K prompt setting, default 48-node projection. Completion-evidence checks are disabled for this informational ledger task, not to hide participant errors.
- Both participants receive the same permanently retained task/query semantics and neutral provider system. Each has its appropriate protocol/context wrapper. Both use the same structured FINAL human-answer envelope; the transcript retains **all** user messages and complete raw responses, even malformed outputs, including any optional memory entries. It is never truncated or summarized.
- In addition to the runtime setting, both GLM request bodies enforce a conservative **64,000 UTF-8-byte** ceiling over serialized system/messages. This is a shared conservative safety bound, not a claim of exactly 64K tokenizer tokens. Overflow is a participant failure; never silently trim the transcript.

## Data, oracle, split and metrics

Generate 30 independent deterministic 60-turn ledger episodes: ten development seeds `117701..117710`, ten validation seeds `227701..227710`, and ten final-test seeds `337701..337710`. Each has fresh state and an opaque entity namespace. Event reduction and structured queries define gold independently of the model.

This budgeted pilot actually visits only development `117701` and validation `227701`; no final-test episode is sent to any model. The full split is generated only for immutable hashes. Generation is not test-set evaluation or a power calculation. A separate single-turn calibration seed `447701` plus one synthetic Jev relevance canary tests output envelopes and transport before scored requests. All calibration calls count against the budget. Calibration failure stops; it is never scored as a development result.

Every participant input includes that turn's ledger events and query, never its oracle answer. The scorer checks only final human-answer JSON, never internal graph contents, optional state, substrings, reasoning or an LLM judge. Empty, wrong, partial and malformed answers fail. Oracle/scorer controls must pass offline before spending.

Primary endpoint: episode accuracy on turns **41–60**. Report full-episode accuracy, parse/protocol failures, provider-specific input/output/cache tokens, all-attempt costs, and latency separately. The unit is the **episode**, not 60 independent samples. With one development and one validation episode, do not present meaningful population confidence bounds or a superiority p-value. No general superiority, equivalence or production recommendation follows.

## Hill-climbing policy

Before seeing scored outputs, fix the hypotheses:

1. Reduce the graph projection node ceiling from 48 to 12, keeping native recall and all other policies fixed, to reduce redundant context without losing relevant current facts.
2. If call reserve permits, test 8 nodes against the incumbent under the same hypothesis.

Each round resets both participant states and replays the complete development episode. Re-run the full-transcript control contemporaneously; do not reuse historical grades.

Candidate selection is deterministic: higher late accuracy with no extra protocol failures wins. On tied late accuracy, require no loss of full-episode accuracy, no extra protocol failures, and at least **5% fewer total graph-arm input tokens, including Jev**. Otherwise keep the incumbent. This can be cost optimization at an accuracy ceiling, not a quality improvement. Repeated development outcomes remain tuning data; temperature zero does not remove model noise.

Reserve 180 requests for one validation pair. Skip a candidate round unless its worst-case 180 requests plus that reserve fit the remaining 600-call cap. Thus “up to two” may become one or zero. Token reservations can stop the run sooner. Run the selected graph configuration and full transcript once on the validation episode; do not tune on validation afterward. This is not a direct held-out default-graph-versus-candidate contrast, and must not be described as independent confirmation of that tuning effect.

## Failure, budget and evidence policy

One process owns the study. It creates an exclusive receipt; a second invocation at the same output path fails. An in-container 45-minute deadline terminates that owned process, not just its SSH client. No persisted live lab session, workspace, historical corpus or experiment state is mutated.

Wrap all network requests before constructing the SDK. Allow only the exact Z.ai messages and TypeSafe SystemOne POST endpoints. Record and fsync a dispatch before sending, then its response/accounting. Do not follow redirects. No automatic retries, failed-turn restarts, backfills or resumption after ambiguous dispatch.

Before dispatch, reserve a conservative token bound: serialized body UTF-8 bytes plus 4,096 input overhead and the 1,024 hard GLM output cap; for Jev, body bytes plus 65,536 overhead and 131,072 output allowance. These are conservative accounting reservations, **not tokenizer proofs or provider-enforced Jev output caps**. Reconcile with returned input/output/cache usage. Stop if usage is missing or exceeds its reservation, retaining unresolved reservations. Unknown cost is never zero. GLM's output limit is provider-enforced; Jev's native endpoint exposes no equivalent max-output parameter. There is consequently residual provider-accounting risk, rather than a mathematically guaranteed token bound for an arbitrary nonconforming provider. No currency-price claim is made for the connected account.

Each attempted request consumes the call cap, including calibration, Jev, transport failures and failed participants. A permanent stop latch prevents SDK fallback from silently continuing with GLM after a budget/provider error. Participant envelope/JSON/overflow failures are explicit failed outcomes. The transcript still retains every input and raw response; graph failures follow the actual SDK's transactional semantics. This deliberately does not weaken the transcript to match graph rollback. Provider/transport/accounting failures stop the cohort; partial pairs and unstarted turns remain incomplete and cannot be quietly excluded from a quality headline.

Preserve request bodies without headers, visible final text, served model/stop reason, native rankings, exact compiled contexts, immutable state deltas/read sets, oracle outcomes, timing and budget snapshots. Exclude raw hidden-thinking blocks. Scan every written record for the in-memory credential bytes. Keys remain in the existing container environment; never read `.env`, print keys, publish header objects, or copy credentials to the evaluation checkout.

## Required offline verification

- Independent reducer/query cases, all negative controls, exactly 60 turns and deterministic/disjoint episodes.
- Total-call/token reservations, unknown usage, cache accounting and exact budget boundaries.
- Selection gates: quality, cost tie-break and protocol-failure rejection.
- A mocked full run must make no real network requests and must preserve the final-test boundary.
- Independent source review before scored execution; record findings and fixes, not only test totals. The first review identified lost transcript history on malformed outputs; fixed before freezing and covered by a full-run malformed-turn regression. The control also accepts the SDK's plain informational/terminal FINAL forms rather than uniquely rejecting a bare JSON human answer. A second finding identified malformed native responses escaping into lexical fallback; fixed with SDK-contract validation inside the fatal transport guard and an actual-SDK malformed-native regression.

Offline checks (no credentials needed; the optional integration check uses fake credentials and mocks all HTTP):

```sh
./node_modules/.bin/vitest run tests/pairedLedger.test.ts
node --test tests/pairedLedgerRunner.node.mjs
PILOT_TEST_SDK=/path/to/copied/deployed/dist node --test tests/pairedLedgerRunner.node.mjs
./node_modules/.bin/tsc --noEmit
```

Post-freeze, offline-only evidence tools (never send provider requests):

```sh
node scripts/paired-ledger/verify-runtime.mjs /path/to/reviewed/src /path/to/copied/dist source-parity.json
node scripts/paired-ledger/analyze.mjs /path/to/terminated/receipt-directory
```

The verifier checks the pinned source revision, deployment byte hashes and normalized transpiled JavaScript. The analyzer refuses active runs, verifies frozen participant/scorer hashes, reconciles requests and all known usage, replays candidate selection and leaves incomplete primary endpoints unavailable. Additional truncation/empty-output diagnostics are descriptive; they do not change the frozen endpoint or scorer.

Actual paid execution is intentionally not a package-script default. It requires the explicitly authorized configured server environment, the deployed SDK `dist` path and a new receipt directory. Never invoke it as an incidental test or retry an existing receipt.

Artifacts are a separately versioned pilot, never corrections to frozen earlier scores. Any stop must be reported honestly, including whether validation was reached.
