---
id: data-retention-019
title: Data retention and deletion program
tldr: Tests whether an agent can translate overlapping retention obligations into executable controls, exceptions, evidence, and customer-facing behavior.
domain: compliance-policy-and-risk
estimated_turns: 8
status: calibration
---

# Data retention and deletion program

## TL;DR

The Challenger asks agents to design and operationalize a retention program across product data, backups, analytics, legal holds, and customer deletion. Requirements change and conflict, forcing careful scope and evidence management.

## Why this scenario exists

Retention and deletion obligations cross systems with different technical realities and exception rules. This scenario tests whether an agent can translate policy into observable controls, preserve a split-duration correction, and communicate backup and legal-hold behavior without impossible promises.

## Private situation

The company stores account, event, support, billing, and security data across primary systems, warehouses, exports, and backups. Contracts and legal requirements differ. This is policy implementation work, not legal advice.

## Canonical request sequence

### Turn 1 — Inventory

> Build a data-system/purpose/owner/retention inventory, identify unknowns, and separate legal, contractual, operational, and assumed requirements.

### Turn 2 — Policy model

> Draft a retention and deletion control model with triggers, exceptions, legal holds, approvals, evidence, and customer-visible expectations.

### Turn 3 — Implementation

> Map controls to primary stores, analytics, caches, exports, logs, and backups. Define verification and failure handling.

### Turn 4 — Correction

> Correction: security audit logs require seven years, not one year, but their payload must be minimized after 13 months. Propagate this split requirement.

### Turn 5 — Deletion request

> Design an end-to-end customer deletion workflow with identity verification, dependency handling, status, and auditable completion.

### Turn 6 — Legal hold

> A legal hold overlaps a deletion request. Define safe precedence, restricted access, communication, and release behavior.

### Turn 7 — Failure exercise

> Simulate a failed deletion worker, stale export, restored backup, and ownerless dataset. Revise controls and monitoring.

### Turn 8 — Final program

> Deliver policy, control matrix, implementation roadmap, exception register, evidence package, customer wording, and review cadence.

## Hidden acceptance criteria

- Seven-year security-log retention and 13-month minimization both persist.
- Legal basis and owner are not invented where unknown.
- Backup handling distinguishes logical deletion, expiry, and restoration controls.
- Legal holds are scoped, access-controlled, and releasable.
- Deletion completion is behaviorally verifiable across systems.
- Exports and derived datasets are included.
- Customer wording does not promise impossible immediate backup erasure.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Trace representative data through every storage class.
- Exercise deletion, hold, release, backup restore, and retry paths.
- Search policy/control artifacts for contradictory durations.
- Verify evidence records without retaining deleted payloads.
- Test monitoring for overdue and failed deletion work.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Control correctness: 25
- Cross-system completeness: 20
- Correction propagation: 15
- Deletion/hold safety: 20
- Evidence and monitoring: 10
- Communication: 10

## Challenger notes

- Score operational consistency, not legal-sounding prose. Flag any artifact that presents assumptions as counsel-approved requirements.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
