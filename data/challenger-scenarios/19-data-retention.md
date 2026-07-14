---
id: data-retention-019
title: Data retention and deletion program
tldr: Tests whether an agent can translate overlapping retention obligations into executable controls, exceptions, evidence, and customer-facing behavior.
domain: compliance-policy-and-risk
estimated_turns: 8
status: draft
---

# Data retention and deletion program

## TL;DR

The Challenger asks agents to design and operationalize a retention program across product data, backups, analytics, legal holds, and customer deletion. Requirements change and conflict, forcing careful scope and evidence management.

## Private situation

The company stores account, event, support, billing, and security data across primary systems, warehouses, exports, and backups. Contracts and legal requirements differ. This is policy implementation work, not legal advice.

## Canonical request sequence

1. **Inventory:** > Build a data-system/purpose/owner/retention inventory, identify unknowns, and separate legal, contractual, operational, and assumed requirements.
2. **Policy model:** > Draft a retention and deletion control model with triggers, exceptions, legal holds, approvals, evidence, and customer-visible expectations.
3. **Implementation:** > Map controls to primary stores, analytics, caches, exports, logs, and backups. Define verification and failure handling.
4. **Correction:** > Correction: security audit logs require seven years, not one year, but their payload must be minimized after 13 months. Propagate this split requirement.
5. **Deletion request:** > Design an end-to-end customer deletion workflow with identity verification, dependency handling, status, and auditable completion.
6. **Legal hold:** > A legal hold overlaps a deletion request. Define safe precedence, restricted access, communication, and release behavior.
7. **Failure exercise:** > Simulate a failed deletion worker, stale export, restored backup, and ownerless dataset. Revise controls and monitoring.
8. **Final program:** > Deliver policy, control matrix, implementation roadmap, exception register, evidence package, customer wording, and review cadence.

## Hidden acceptance criteria

- Seven-year security-log retention and 13-month minimization both persist.
- Legal basis and owner are not invented where unknown.
- Backup handling distinguishes logical deletion, expiry, and restoration controls.
- Legal holds are scoped, access-controlled, and releasable.
- Deletion completion is behaviorally verifiable across systems.
- Exports and derived datasets are included.
- Customer wording does not promise impossible immediate backup erasure.

## Behavioral verification

- Trace representative data through every storage class.
- Exercise deletion, hold, release, backup restore, and retry paths.
- Search policy/control artifacts for contradictory durations.
- Verify evidence records without retaining deleted payloads.
- Test monitoring for overdue and failed deletion work.

## Quality rubric

Control correctness 25; cross-system completeness 20; correction propagation 15; deletion/hold safety 20; evidence and monitoring 10; communication 10.

## Challenger notes

Score operational consistency, not legal-sounding prose. Flag any artifact that presents assumptions as counsel-approved requirements.
