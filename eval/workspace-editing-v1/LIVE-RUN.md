# Workspace editing v1 — authorized live run

Status: corrected non-Flash `glm-5.3` execution completed; the one-pass authority is consumed.

## Human authorization

On 2026-11-08 the user explicitly asked to run the evaluator and publish a development-only review portal. The first pass mistakenly used `glm-5.3-flash`. The user then explicitly corrected the target to non-Flash `glm-5.3` and authorized one fresh pass with the same five cases, ceilings, arm order, and zero retries.

The Flash result remains preserved as wrong-model evidence and cannot answer the intended question. The corrected runtime must report:

- Anthropic-compatible HTTP adapter;
- endpoint `api.z.ai/api/anthropic`;
- configured and served model `glm-5.3`;
- credential present without ever printing or persisting it.

The adapter label is not the model vendor. Live evidence and the report identify the provider as Z.ai and require the exact non-Flash model ID.

## Frozen execution profile

- Cases: approved `SDKWS-01` through `SDKWS-05` only.
- Repetitions: one paired pass.
- Arm order: Graph first on odd-numbered cases, Messages first on even-numbered cases.
- Model: exact configured and served non-Flash `glm-5.3` through `api.z.ai/api/anthropic`.
- Temperature: `0` for both arms.
- Output ceiling: `4,096` tokens per request for both arms.
- Prompt ceiling: `64,000` estimated full-request tokens per request for both arms.
- Call ceiling: `12` model calls per turn for both arms.
- Global ceilings: `240` provider calls and `5,000,000` conservatively reserved prompt-plus-output tokens.
- Timeout: `180` seconds per request.
- Provider transport and episode retries: none. Normal protocol-error feedback may consume another model iteration within the matched per-turn call ceiling; malformed output is never repaired.
- Fatal stopping: stop the complete run on the first provider/model transport failure, endpoint mismatch, budget breach, or integrity failure. An exhausted protocol loop remains `grade: null` and receives no new episode attempt.
- Billing: Z.ai coding-plan access; report exact known usage and conservative reservations, with no invented per-token dollar estimate.
- Publication: sanitized static portal in StateWeave development only. Do not promote to UAT or production.

## Safety and evidence

The live entry point is not part of default tests, builds, demos, CLI behavior, or package exports. It requires an exact non-secret execution acknowledgement plus the authorized runtime environment. It never loads `.env`.

Before dispatch it verifies SHA-256 hashes for the frozen cases, grader, paired runner, live adapters, orchestrator, and all imported SDK source files. Both arms share one budget ledger. Z.ai responses must report the exact served model and stop reason; completed pairs must pass endpoint matching before aggregate paired interpretation.

Results are written atomically after every arm. They include actual workspace bytes, transcripts/calls, traces, grades or `grade: null` failure evidence, provider metadata/usage, limits, source revision, arm order, and stop reason. The provider credential is checked against serialized output and must never be persisted.

A single five-case pass is descriptive. It does not establish statistical significance or a general superiority claim.
