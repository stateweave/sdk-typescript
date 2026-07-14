---
id: permissions-redesign-005
title: Multi-tenant permissions redesign
tldr: Tests whether an agent can evolve authorization across many turns without creating privilege escalation or breaking legacy roles.
domain: product-engineering
estimated_turns: 7
status: draft
---

# Multi-tenant permissions redesign

## TL;DR

A product grows from three fixed roles to tenant-defined roles and resource-scoped permissions. The agent must map existing behavior, migrate safely, handle corrections, prove denial paths, and support an incremental rollout.

## Private situation

The system serves regulated customers. Authorization is enforced inconsistently in API handlers and background jobs. Existing owner, admin, and member behavior is contractually important. A super-admin support path exists but must remain tightly audited.

## Canonical request sequence

1. **Map:** > Audit current authorization decisions across UI, API, jobs, and support tooling. Produce a permission matrix and identify dangerous inconsistencies. Do not implement yet.
2. **Core model:** > Implement a backward-compatible permission model and migration for tenant-defined roles. Preserve all current role outcomes.
3. **Resource scope:** > Add project-scoped grants and explicit denial behavior. Ensure list endpoints cannot leak resources filtered out of detail endpoints.
4. **Correction:** > Correction: project owners may manage project membership but may not grant tenant-level billing or export permissions. Propagate this distinction everywhere.
5. **Automation:** > Background jobs and API tokens need the same effective permissions as their initiating principal, with durable audit evidence.
6. **Adversarial hardening:** > Test cross-tenant access, stale sessions, role deletion, conflicting grants, support impersonation, and cache invalidation. Fix real weaknesses.
7. **Rollout review:** > Prepare a staged release with comparison logging, rollback, customer migration guidance, and a final verified permission matrix.

## Hidden acceptance criteria

- Every authorization decision is tenant-bound and deny-by-default.
- Legacy roles retain equivalent effective permissions.
- Collection and detail endpoints agree on visibility.
- Project ownership never implies tenant billing/export rights.
- Jobs and tokens cannot retain permissions revoked from the initiating principal.
- Support impersonation is time-bounded, visible, and audited.
- Permission-cache invalidation is demonstrated rather than assumed.
- Rollback does not strand custom-role customers.

## Behavioral verification

- Attempt cross-tenant access through API, jobs, exports, and indirect identifiers.
- Compare old and migrated role matrices using representative accounts.
- Revoke access during an active session and queued job.
- Delete and recreate custom roles with conflicting grants.
- Exercise support impersonation expiration and audit records.
- Run existing authorization regressions plus newly authored denial tests.

## Quality rubric

Security behavior 35; legacy compatibility 20; correction propagation 15; adversarial verification 15; rollout safety 10; clarity 5.

## Challenger notes

A response cannot earn full credit from a permission table alone. Hidden checks exercise observable denial and revocation paths.
