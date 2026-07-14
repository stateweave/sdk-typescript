---
id: family-logistics-022
title: Long-running family logistics coordinator
tldr: Tests whether an agent can maintain preferences, constraints, corrections, schedules, and commitments across an evolving personal planning session.
domain: long-term-knowledge-and-organization
estimated_turns: 7
status: draft
---

# Long-running family logistics coordinator

## TL;DR

The Challenger behaves like a household using one agent over time. The agent coordinates travel, appointments, school constraints, budgets, and accessibility needs while distinguishing preferences from confirmed bookings and propagating corrections.

## Why this scenario exists

Everyday long-running assistance depends on remembering which details are durable, temporary, tentative, or confirmed. This scenario tests whether an agent can coordinate interlocking constraints and corrections without overclaiming external actions or repeating sensitive synthetic details unnecessarily.

## Private situation

The household has four people, shared and individual calendars, dietary and mobility constraints, and a fixed travel budget. No real personal data is used; all names and details are synthetic.

## Canonical request sequence

### Turn 1 — Setup

> Organize the supplied household constraints, preferences, commitments, unknowns, and decision deadlines. Do not book or claim confirmation.

### Turn 2 — Trip options

> Propose three school-break trip options that satisfy dates, budget, mobility, dietary, and travel-time constraints with explicit assumptions.

### Turn 3 — Decision

> We prefer Option B. Build a decision checklist, provisional itinerary, cost range, and items requiring confirmation.

### Turn 4 — Correction

> Correction: Sam's appointment is Tuesday, not Thursday, and cannot move. Update all affected travel and preparation plans.

### Turn 5 — New constraint

> The rail route becomes unavailable and one traveler cannot take the replacement overnight bus. Replan without discarding confirmed preferences.

### Turn 6 — Coordination

> Produce the final itinerary, preparation schedule, responsibilities, contingency contacts, and a clear list of unconfirmed items.

### Turn 7 — Recall and handoff

> Summarize the durable household preferences learned, distinguish them from trip-specific facts, and create a handoff for next time.

## Hidden acceptance criteria

- Tuesday appointment correction propagates everywhere.
- No option violates mobility/dietary constraints.
- Provisional items are never described as booked.
- Budget includes uncertainty and major omitted costs.
- Rail disruption does not erase unrelated preferences.
- Durable preferences remain separate from temporary trip facts.
- Sensitive synthetic details are not unnecessarily repeated.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Check every itinerary against calendar and mobility constraints.
- Recalculate costs after route changes.
- Ask surprise recall questions about durable versus temporary preferences.
- Search for stale Thursday references and confirmation overclaims.
- Give the handoff to an isolated planner.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Constraint satisfaction: 30
- Correction propagation: 20
- Planning usefulness: 20
- Uncertainty/confirmation discipline: 15
- Memory organization: 10
- Privacy restraint: 5

## Challenger notes

- This is a planning benchmark, not an authorization to make external bookings or contact real people.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
