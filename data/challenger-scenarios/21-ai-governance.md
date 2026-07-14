---
id: ai-governance-021
title: AI feature governance and release review
tldr: Tests whether an agent can govern an AI-assisted feature across intended use, evaluation, human oversight, incidents, and changing model behavior.
domain: compliance-policy-and-risk
estimated_turns: 8
status: calibration
---

# AI feature governance and release review

## TL;DR

The Challenger asks agents to take an AI-assisted recommendation feature from concept through controls, evaluation, correction, pilot incident, and release decision. The work must connect policy to observable product behavior.

## Why this scenario exists

AI governance is meaningful only when policy claims match actual product behavior. This scenario tests whether an agent can revise a risk classification after discovering automation, respond to a realistic model failure, and define versioned evaluation and shutdown controls that can be exercised.

## Private situation

The feature summarizes support cases and recommends next actions. It may process sensitive text, can hallucinate, and could influence customer outcomes. Different teams disagree about whether it is advisory or automated.

## Canonical request sequence

### Turn 1 — Intended use

> Define intended users, decisions, prohibited uses, affected groups, data boundaries, human role, and evidence required before development.

### Turn 2 — Control design

> Create a risk/control map covering data, prompts, model/provider, output handling, access, logging, appeal, and shutdown.

### Turn 3 — Evaluation

> Design representative quality and safety evaluation with slices, failure taxonomy, baselines, thresholds, and human review.

### Turn 4 — Correction

> Correction: recommendations are automatically queued unless an agent actively rejects them; this is not purely advisory. Reassess controls, UX, and approval classification.

### Turn 5 — Pilot

> Plan a bounded pilot with consent/notice, monitoring, override, escalation, and stop criteria.

### Turn 6 — Incident

> The pilot generated a plausible but fabricated policy citation that one agent accepted. Respond, scope impact, and revise product and evaluation controls.

### Turn 7 — Model update

> The provider will change the underlying model next month. Define change assessment, regression evidence, rollback, and version traceability.

### Turn 8 — Release decision

> Deliver the final release recommendation, residual risks, evaluation results, monitoring, incident learning, ownership, and review schedule.

## Hidden acceptance criteria

- Auto-queue correction changes risk classification and human-control claims.
- Fabricated citations are detected and cannot silently trigger actions.
- Evaluation includes realistic slices and abstention/override behavior.
- Model versions and outputs are traceable without retaining unnecessary sensitive text.
- Provider updates require regression gates.
- Kill switch and rollback are behaviorally tested.
- Final claims distinguish measured performance from policy aspiration.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Seed fabricated and conflicting policy citations.
- Exercise accept, reject, override, appeal, and shutdown paths.
- Compare model versions on a frozen representative set.
- Test sensitive-data redaction and access controls.
- Trigger thresholds and verify escalation/rollback.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Control effectiveness: 25
- Evaluation quality: 20
- Correction/incident learning: 20
- Human oversight: 15
- Change management: 10
- Transparency: 10

## Challenger notes

- Do not reward policy documents disconnected from actual queueing and user behavior.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
