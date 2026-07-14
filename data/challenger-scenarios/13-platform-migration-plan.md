---
id: platform-migration-plan-013
title: Cross-team platform migration
tldr: Tests whether an agent can coordinate a multi-quarter migration with dependencies, ownership, changing constraints, and measurable exit criteria.
domain: project-planning-and-coordination
estimated_turns: 8
status: calibration
---

# Cross-team platform migration

## TL;DR

The Challenger simulates a program sponsor migrating six teams from a legacy platform. The agent must maintain an executable plan, reconcile dependencies and capacity, respond to corrections, and preserve accountability across a long session.

## Why this scenario exists

Multi-team migrations fail when dates are presented without dependency truth, capacity evidence, or decision ownership. This scenario measures whether an agent can preserve an executable critical path through corrections and observed pilot slippage in one continuous planning session.

## Private situation

The legacy platform is expensive but stable. Teams have different readiness, contractual blackout periods, and shared dependencies. Leadership wants a date, but sequencing and rollback evidence matter more than optimistic certainty.

## Canonical request sequence

### Turn 1 — Discovery

> Build a migration inventory, stakeholder map, dependency graph, assumptions, unknowns, and readiness criteria. Do not promise a final date yet.

### Turn 2 — Plan

> Propose waves, milestones, owners, capacity assumptions, critical path, decision points, and rollback requirements.

### Turn 3 — Constraint

> Team Delta cannot migrate during its eight-week regulatory blackout. Re-sequence without silently moving risk to dependent teams.

### Turn 4 — Correction

> Correction: the shared identity service will not be ready in Q2; its committed date is mid-Q3. Update every affected milestone and forecast.

### Turn 5 — Pilot

> Define a representative pilot, entry/exit criteria, support model, and evidence required before the next wave.

### Turn 6 — Slippage

> The pilot is three weeks late and consumed twice the expected platform support. Reforecast capacity and communicate options.

### Turn 7 — Governance

> Create the operating cadence, risk escalation, change control, status definitions, and executive reporting contract.

### Turn 8 — Baseline

> Deliver the final integrated plan, critical path, dependencies, resource profile, decision log, contingency paths, and confidence range.

## Hidden acceptance criteria

- The identity-service correction propagates to all dependent waves.
- Regulatory blackout is a hard constraint.
- Owners and decision dates accompany major dependencies.
- Pilot evidence gates later waves.
- Reforecast incorporates observed support consumption.
- Status distinguishes forecast, commitment, and aspiration.
- Rollback and coexistence are planned, not implied.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Traverse the dependency graph for impossible dates.
- Compare resource demand with stated team capacity.
- Apply correction and slippage events to the critical path.
- Test pilot failure and identity-service delay contingencies.
- Ask isolated reviewers to identify current owner and next decision for each risk.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Plan coherence: 25
- Dependency/correction integrity: 20
- Resource realism: 15
- Governance: 15
- Contingency quality: 15
- Communication: 10

## Challenger notes

- Reward plans that remain executable after disruption. Penalize polished timelines with impossible dependencies.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
