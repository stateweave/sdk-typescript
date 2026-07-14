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

## Private situation

The product has active subscriptions, asynchronous payment-provider webhooks, internal entitlements, and finance exports. Historical invoice totals must never be rewritten. A staged rollout is required because enterprise contracts differ from self-service plans.

## Canonical request sequence

1. **Audit:** > Inspect billing, entitlement, webhook, and invoice flows. Produce a dependency map and migration plan without changing code.
2. **Foundation:** > Add the smallest backward-compatible foundation for hybrid seat-and-usage billing. Keep every existing subscription working and verify current regressions.
3. **Usage:** > Add durable usage recording with idempotency, late-arriving events, and an auditable calculation trail.
4. **Correction:** > Correction: enterprise contracts bill usage in arrears, but self-service plans pre-purchase credits. Update the design without rewriting historical invoices.
5. **Provider failures:** > Webhooks can arrive duplicated, delayed, and out of order. Harden reconciliation and demonstrate recovery behavior.
6. **Rollout:** > Add a reversible cohort rollout with shadow calculations and a finance-visible discrepancy report.
7. **Dispute:** > A customer disputes a charge. Build the evidence package from durable records and identify any remaining ambiguity.
8. **Release:** > Review the complete migration, fix mismatches, run behavioral and regression checks, and write rollout, rollback, reconciliation, and limitation documentation.

## Hidden acceptance criteria

- Existing plans and historical invoice totals remain unchanged.
- Usage events have durable idempotency keys and immutable audit provenance.
- Late and reordered events reconcile deterministically.
- Enterprise arrears and self-service credits remain distinct after Turn 4.
- Entitlements do not depend on an eventually consistent invoice webhook.
- Shadow calculations cannot charge customers.
- Rollback preserves events collected during the rollout.
- Final dispute evidence can be reproduced from stored inputs and rules.

## Behavioral verification

- Replay duplicate, delayed, and reordered events across billing periods.
- Compare historical invoices before and after migration.
- Exercise enterprise arrears and self-service credit exhaustion.
- Simulate provider downtime, recovery, and webhook replay.
- Run a cohort in shadow mode and reconcile intentional discrepancies.
- Roll back and forward again without losing usage.

## Quality rubric

Observable billing correctness 30; compatibility and financial safety 25; reconciliation evidence 15; rollout/rollback quality 15; verification 10; honest limitations 5.

## Challenger notes

Broadcast requests unchanged. Judge monetary outcomes and auditability behaviorally; do not require a preferred schema or payment provider architecture.
