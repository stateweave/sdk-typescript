---
id: learning-program-023
title: Adaptive professional learning program
tldr: Tests whether an agent can maintain a months-long learning plan, incorporate performance evidence, revise misconceptions, and preserve motivation without lowering standards.
domain: long-term-knowledge-and-organization
estimated_turns: 8
status: draft
---

# Adaptive professional learning program

## TL;DR

The Challenger simulates a learner working with one agent through assessment, planning, practice, feedback, correction, setbacks, and final reflection. The agent must adapt from evidence rather than repeat generic encouragement.

## Why this scenario exists

A useful learning agent must change the plan when performance evidence or available time changes. This scenario tests whether it can correct a faulty assessment, preserve prerequisite logic, distinguish different error types, and maintain standards while adapting workload realistically.

## Private situation

A synthetic learner is preparing for a technical role transition. They have uneven foundations, limited weekly time, and a tendency to mistake recognition for recall. Work samples and quiz results arrive over time.

## Canonical request sequence

### Turn 1 — Assessment

> Build a skills map from the supplied goals and evidence. Separate demonstrated ability, self-report, unknowns, and prerequisites.

### Turn 2 — Plan

> Create a six-week learning plan with outcomes, deliberate practice, retrieval, projects, checkpoints, and a realistic weekly budget.

### Turn 3 — Evidence

> Review the first work sample and quiz. Diagnose errors, update the skills map, and revise next week's practice.

### Turn 4 — Correction

> Correction: the networking quiz answer key marked two correct answers wrong. Re-score it and update every conclusion based on those items.

### Turn 5 — Setback

> The learner missed a week and has only four hours next week. Reprioritize without pretending all original outcomes still fit.

### Turn 6 — Transfer

> Design a project that tests transfer across multiple skills rather than rehearsing the examples already seen.

### Turn 7 — Feedback

> Evaluate the project against predeclared criteria, distinguish knowledge gaps from execution mistakes, and prescribe targeted revision.

### Turn 8 — Retrospective

> Produce the final evidence-based skills map, remaining gaps, durable study preferences, next plan, and a changelog of adaptations.

## Hidden acceptance criteria

- Corrected quiz items alter scores and derived gap claims.
- Plan respects weekly time and prerequisites.
- Activities include retrieval and transfer, not reading only.
- Missed week causes explicit scope tradeoffs.
- Feedback cites observable work evidence.
- Encouragement does not replace standards.
- Durable learning preferences remain separate from transient schedule facts.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Recalculate quiz and skill map after correction.
- Compare planned workload with available hours.
- Test project novelty versus memorized examples.
- Trace final skill claims to work samples/checkpoints.
- Ask delayed recall questions from early prerequisites.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Evidence-based adaptation: 25
- Correction propagation: 15
- Learning design: 20
- Realistic prioritization: 15
- Feedback quality: 15
- Durable memory: 10

## Challenger notes

- Reward calibrated adaptation, not maximal content or motivational verbosity.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
