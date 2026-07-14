---
id: crisis-communications-017
title: Evolving service-incident communications
tldr: Tests whether an agent can communicate during a crisis as facts change, avoiding speculation, contradiction, and premature closure.
domain: writing-and-stakeholder-communication
estimated_turns: 8
status: draft
---

# Evolving service-incident communications

## TL;DR

The agent maintains internal, customer, executive, and public communications during a service disruption. It must preserve factual consistency while tailoring detail, correcting errors, and avoiding promises unsupported by operations.

## Why this scenario exists

Crisis communication accumulates public commitments while the underlying facts remain unstable. This scenario measures whether an agent can tailor detail by audience without changing core facts, propagate corrections everywhere, and avoid converting a working hypothesis into an official cause.

## Private situation

A payment service is intermittently failing. Impact scope and cause are initially uncertain. Updates must be timely, but legal and support teams need different detail than a public status page.

## Canonical request sequence

### Turn 1 — Framework

> Create a communication cadence, audience map, approval path, factual source of truth, and first holding messages from the known incident facts.

### Turn 2 — Update

> Evidence now shows elevated failures in two regions, with no confirmed data loss. Draft audience-specific updates and list unresolved questions.

### Turn 3 — Correction

> Correction: the first dashboard undercounted mobile failures. Total affected transactions are approximately 2.4 times the initial estimate. Correct all active narratives.

### Turn 4 — Cause uncertainty

> Engineers have a leading hypothesis but no confirmation. Communicate progress without presenting the hypothesis as root cause.

### Turn 5 — Mitigation

> A mitigation reduced errors but increased latency. Draft updates that explain customer impact and next checks accurately.

### Turn 6 — Recovery

> Error rates are normal for 30 minutes. Prepare monitoring-stage communications and closure criteria without declaring final resolution early.

### Turn 7 — Resolution

> Closure criteria are met. Produce final customer, executive, support, and status-page messages with consistent scope and timing.

### Turn 8 — Post-incident

> Write the communication retrospective, correction log, template improvements, and commitments that have explicit owners.

## Hidden acceptance criteria

- Mobile undercount correction appears everywhere after Turn 3.
- No-data-loss language remains qualified until evidence supports it.
- Hypothesis and confirmed cause never blur.
- Mitigation tradeoff is communicated honestly.
- Audience detail varies without changing core facts.
- Resolution waits for declared closure criteria.
- Commitments have owners and are not invented.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Compare dates, scope, impact, and status across every audience artifact.
- Search for stale initial impact estimates.
- Classify each causal statement as confirmed, likely, or unknown.
- Simulate a customer reading sequential updates for contradiction.
- Verify final commitments against the action register.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Factual consistency: 30
- Correction handling: 20
- Uncertainty discipline: 15
- Audience adaptation: 15
- Operational timing: 10
- Clarity: 10

## Challenger notes

- Faster prose is not better if it outruns incident evidence.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
