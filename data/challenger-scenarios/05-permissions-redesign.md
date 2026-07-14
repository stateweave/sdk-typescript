---
id: permissions-redesign-005
title: Multi-tenant permissions redesign
tldr: Tests whether an agent can evolve authorization across many turns without creating privilege escalation or breaking legacy roles.
domain: product-engineering
estimated_turns: 7
status: held-out
---

# Multi-tenant permissions redesign

## TL;DR

A product grows from three fixed roles to tenant-defined roles and resource-scoped permissions. The agent must map existing behavior, migrate safely, handle corrections, prove denial paths, and support an incremental rollout.

## Why this scenario exists

Authorization work often appears complete when the happy path succeeds, while collection endpoints, jobs, caches, and stale sessions preserve hidden privilege. This scenario tests whether the agent can maintain one coherent security model across layers and revise it after a consequential scope correction.

## Private situation

The system serves regulated customers. Authorization is enforced inconsistently in API handlers and background jobs. Existing owner, admin, and member behavior is contractually important. A super-admin support path exists but must remain tightly audited.

## Canonical request sequence

### Turn 1 — Map

> Audit current authorization decisions across UI, API, jobs, and support tooling. Produce a permission matrix and identify dangerous inconsistencies. Do not implement yet.

### Turn 2 — Core model

> Implement a backward-compatible permission model and migration for tenant-defined roles. Preserve all current role outcomes.

### Turn 3 — Resource scope

> Add project-scoped grants and explicit denial behavior. Ensure list endpoints cannot leak resources filtered out of detail endpoints.

### Turn 4 — Correction

> Correction: project owners may manage project membership but may not grant tenant-level billing or export permissions. Propagate this distinction everywhere.

### Turn 5 — Automation

> Background jobs and API tokens need the same effective permissions as their initiating principal, with durable audit evidence.

### Turn 6 — Adversarial hardening

> Test cross-tenant access, stale sessions, role deletion, conflicting grants, support impersonation, and cache invalidation. Fix real weaknesses.

### Turn 7 — Rollout review

> Prepare a staged release with comparison logging, rollback, customer migration guidance, and a final verified permission matrix.

## Hidden acceptance criteria

- Every authorization decision is tenant-bound and deny-by-default.
- Legacy roles retain equivalent effective permissions.
- Collection and detail endpoints agree on visibility.
- Project ownership never implies tenant billing/export rights.
- Jobs and tokens cannot retain permissions revoked from the initiating principal.
- Support impersonation is time-bounded, visible, and audited.
- Permission-cache invalidation is demonstrated rather than assumed.
- Rollback does not strand custom-role customers.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Attempt cross-tenant access through API, jobs, exports, and indirect identifiers.
- Compare old and migrated role matrices using representative accounts.
- Revoke access during an active session and queued job.
- Delete and recreate custom roles with conflicting grants.
- Exercise support impersonation expiration and audit records.
- Run existing authorization regressions plus newly authored denial tests.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Security behavior: 35
- Legacy compatibility: 20
- Correction propagation: 15
- Adversarial verification: 15
- Rollout safety: 10
- Clarity: 5

## Challenger notes

- A response cannot earn full credit from a permission table alone. Hidden checks exercise observable denial and revocation paths.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
