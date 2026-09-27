# Confirmation engineering preflight

No held-out provider calls were made during these checks. Every offline answer is the literal `OFFLINE HARNESS CHECK ONLY`; injected errors and reported token counts are simulated, not efficacy or billing evidence.

## Preserved attempts

- **Offline A:** completed 588 simulated arms, with two injected main 429 failures and two Jev 520 fallbacks (one followed by a failed main call). The source audit then failed: six held-out cases repeat a session identifier with the same conversation body and different date headers. The original importer treated those records as resource versions and its single-value mapping could not identify every occurrence. This is an engineering failure, not a discarded answer-quality result.
- **Offline B:** occurrence-preserving import passed all 196 cases: 586 successful states audited; both failed committed states retained the original sources; the failed native arm retained its fallback diagnostic. Fixtures/gold/split were not changed.
- **Offline C:** final storage-helper path repeated the same deterministic checks, passed the 196-case audit, and accounted for all 588 main and 196 Jev dispatches. Two main 429s and two Jev 520s have explicitly incomplete usage. Reopening the same output was rejected before another dispatch.

The importer assigns an occurrence suffix only when an identifier repeats, in all arms. Unique-source node identities are unchanged. The synthetic importer/storage test verifies preservation of all dated occurrences, ordinary unique identity, mode-0600 creation, durable exclusive receipts and refusal to overwrite them.

## Verified boundaries

- 283 SDK tests / 39 files; SDK and web typechecks; SDK build; package verification (135 files, 724,284 unpacked bytes).
- 21 Python tests: fixed corpus/support exclusions, isolated judge invocations, packet-bound caches, ambiguous-start refusal, timeout preservation, original-text/flag-bound scoring, statistics, all-start accounting and adoption gates. The 15 dataset-independent tests also run in CI.
- Both old and hardened runtimes replay all 56 recorded development lexical/native paths with exact prompt/trace/state/answer parity and zero network. Only recorded timestamps are restored inside replay; it is not a new efficacy run or broad lifecycle certification.
- Development scores and comparisons remain unchanged after the stronger evidence binding. Calibration and case votes are checked against original provider text, exact packets and isolation flags, without invoking providers again.
- Confirmation uses an explicit execution acknowledgment, final committed freeze, full runtime/fixture/script hashes, an exclusive persistent one-live-cohort receipt and no automatic replay. The blind judge requires a byte-bound configured-provider credential scan before calls; final scoring also requires an exact-byte Pi-auth scan.

Offline attempts, logs, hashes and corrected audit/accounting outputs are retained outside the package. A final freeze must be committed before live execution. Neither engineering success nor development significance authorizes deployment.
