---
id: conference-launch-014
title: Conference product launch coordination
tldr: Tests whether an agent can coordinate a fixed-date launch across product, marketing, legal, support, and operations while scope changes.
domain: project-planning-and-coordination
estimated_turns: 7
status: draft
---

# Conference product launch coordination

## TL;DR

A fixed conference date creates pressure to confuse desired scope with committed scope. The agent must build a cross-functional launch plan, preserve approval and readiness gates, adapt to a supplier failure, and produce clear go/no-go evidence.

## Why this scenario exists

A fixed public date creates pressure to turn aspirations into commitments and suppress bad news. This scenario tests whether the agent can preserve legal and readiness gates, construct credible degraded modes, and coordinate a launch that remains operable when a major dependency misses rehearsal.

## Private situation

The launch includes software, a hardware demo, press materials, customer previews, legal claims, support preparation, and live-event operations. Some elements can degrade gracefully; others create reputational or regulatory risk.

## Canonical request sequence

### Turn 1 — Launch map

> Build workstreams, dependencies, owners, critical decisions, long-lead items, and a definition of launch-ready for the conference date.

### Turn 2 — Scope

> Separate must-have, reversible, and deferrable scope. Create a baseline schedule and evidence-based status format.

### Turn 3 — Claims

> Legal says two marketing claims require substantiation before publication. Add approval gates and safe fallback copy.

### Turn 4 — Correction

> Correction: the hardware supplier date was a ship date, not an arrival date. It now misses rehearsal by nine days. Replan the experience.

### Turn 5 — Rehearsal

> Design a full launch rehearsal covering demo failure, network loss, press timing, support escalation, and rollback.

### Turn 6 — Go/no-go

> Facilitate the readiness review using explicit criteria, unresolved risks, owners, and contingency options.

### Turn 7 — Handoff

> Deliver the final runbook, communications schedule, decision log, day-of roles, fallback experience, and post-launch monitoring.

## Hidden acceptance criteria

- Unsupported claims never reach published materials.
- Ship/arrival correction changes hardware-dependent milestones.
- A software-only fallback remains credible.
- Go/no-go criteria are defined before the decision.
- Day-of ownership and escalation are unambiguous.
- Fixed date does not erase safety/legal gates.
- Post-launch support and monitoring are included.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Simulate hardware absence, network loss, and demo corruption.
- Trace every public claim to approval evidence or fallback copy.
- Walk the runbook with product, press, and support roles.
- Check timing dependencies across time zones.
- Verify all unresolved risks have owners and decision deadlines.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Cross-functional coherence: 25
- Correction/contingency quality: 20
- Readiness evidence: 20
- Ownership: 15
- Communications: 10
- Operational usability: 10

## Challenger notes

- Do not reward a launch that succeeds only in the happy path.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
