---
id: billing-migration-004
title: Subscription billing migration
tldr: Tests whether an agent can replace a billing model gradually while preserving invoices, entitlements, webhooks, and rollback safety.
domain: product-engineering
estimated_turns: 8
status: draft
---

# Subscription billing migration

## TL;DR

The Challenger acts as a product and engineering lead migrating a live SaaS product from seat-only billing to hybrid seat-and-usage billing. The agent must preserve historical invoices and existing customers while requirements, provider behavior, and rollout constraints evolve.

## Why this scenario exists

Billing migrations combine irreversible financial records with asynchronous systems and changing commercial rules. This scenario pressures an agent to retain distinctions across customer cohorts, connect every charge to evidence, and treat rollout and rollback as product behavior rather than documentation exercises.

## Private situation

The product has active subscriptions, asynchronous payment-provider webhooks, internal entitlements, and finance exports. Historical invoice totals must never be rewritten. A staged rollout is required because enterprise contracts differ from self-service plans.

## Canonical request sequence

### Turn 1 — Audit

> Inspect billing, entitlement, webhook, and invoice flows. Produce a dependency map and migration plan without changing code.

### Turn 2 — Foundation

> Add the smallest backward-compatible foundation for hybrid seat-and-usage billing. Keep every existing subscription working and verify current regressions.

### Turn 3 — Usage

> Add durable usage recording with idempotency, late-arriving events, and an auditable calculation trail.

### Turn 4 — Correction

> Correction: enterprise contracts bill usage in arrears, but self-service plans pre-purchase credits. Update the design without rewriting historical invoices.

### Turn 5 — Provider failures

> Webhooks can arrive duplicated, delayed, and out of order. Harden reconciliation and demonstrate recovery behavior.

### Turn 6 — Rollout

> Add a reversible cohort rollout with shadow calculations and a finance-visible discrepancy report.

### Turn 7 — Dispute

> A customer disputes a charge. Build the evidence package from durable records and identify any remaining ambiguity.

### Turn 8 — Release

> Review the complete migration, fix mismatches, run behavioral and regression checks, and write rollout, rollback, reconciliation, and limitation documentation.

## Hidden acceptance criteria

- Existing plans and historical invoice totals remain unchanged.
- Usage events have durable idempotency keys and immutable audit provenance.
- Late and reordered events reconcile deterministically.
- Enterprise arrears and self-service credits remain distinct after Turn 4.
- Entitlements do not depend on an eventually consistent invoice webhook.
- Shadow calculations cannot charge customers.
- Rollback preserves events collected during the rollout.
- Final dispute evidence can be reproduced from stored inputs and rules.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Replay duplicate, delayed, and reordered events across billing periods.
- Compare historical invoices before and after migration.
- Exercise enterprise arrears and self-service credit exhaustion.
- Simulate provider downtime, recovery, and webhook replay.
- Run a cohort in shadow mode and reconcile intentional discrepancies.
- Roll back and forward again without losing usage.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Observable billing correctness: 30
- Compatibility and financial safety: 25
- Reconciliation evidence: 15
- Rollout/rollback quality: 15
- Verification: 10
- Honest limitations: 5

## Challenger notes

- Broadcast requests unchanged. Judge monetary outcomes and auditability behaviorally; do not require a preferred schema or payment provider architecture.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
