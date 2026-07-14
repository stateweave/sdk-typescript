---
id: technical-handbook-018
title: Living technical handbook reconstruction
tldr: Tests whether an agent can build and maintain a coherent handbook from fragmented sources while resolving contradictions and preserving useful history.
domain: writing-and-stakeholder-communication
estimated_turns: 7
status: draft
---

# Living technical handbook reconstruction

## TL;DR

The Challenger provides scattered runbooks, READMEs, tickets, and interview notes over time. The agent must create a navigable handbook, reconcile conflicts, update it after operational changes, and retain provenance and ownership.

## Why this scenario exists

Documentation reconstruction is difficult because duplication and authority matter as much as missing prose. This scenario tests whether an agent can preserve provenance, remove an unsafe procedure from active use, and build governance that keeps the handbook reliable after the initial cleanup.

## Private situation

New engineers cannot tell which documents are current. Some procedures differ between regions, and one obsolete recovery command remains widely copied. The handbook must become maintainable, not merely comprehensive.

## Canonical request sequence

### Turn 1 — Inventory

> Inventory the supplied technical documentation, identify authority, duplication, contradiction, staleness, owners, and critical gaps. Do not merge blindly.

### Turn 2 — Architecture

> Propose and create a minimal handbook structure with navigation, source provenance, status labels, and contribution rules.

### Turn 3 — Core content

> Consolidate onboarding, architecture, deployment, incident, and data-recovery guidance while preserving region-specific differences.

### Turn 4 — Correction

> Correction: `restore --force-primary` is obsolete and unsafe after the storage migration. Replace it with the current recovery process and identify every reference.

### Turn 5 — Operational change

> Deployments now use progressive delivery. Update procedures, rollback guidance, examples, and ownership without erasing the former approach's historical context.

### Turn 6 — Reader test

> Test the handbook with onboarding, incident, and routine-change questions. Fix navigation and ambiguity exposed by those tasks.

### Turn 7 — Governance

> Deliver the reviewed handbook plus ownership map, freshness policy, automated checks, unresolved conflicts, and maintenance backlog.

## Hidden acceptance criteria

- Unsafe recovery command is absent from active instructions after Turn 4.
- Historical references are clearly non-executable.
- Regional differences are explicit.
- Pages expose owner, status, and last-reviewed evidence.
- Navigation supports tasks, not organizational mirroring alone.
- Progressive delivery changes rollback and deployment sections consistently.
- Unresolved conflicts remain visible.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Search active docs and snippets for unsafe commands.
- Give isolated readers realistic tasks and measure successful navigation.
- Validate internal links and referenced files.
- Compare deployment and rollback terminology across pages.
- Simulate an overdue review and owner departure.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Safety/correctness: 25
- Cross-document consistency: 20
- Task usability: 20
- Correction propagation: 15
- Governance: 10
- Provenance: 10

## Challenger notes

- Volume is not quality. Penalize duplicated pages and active instructions without authority or ownership.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
