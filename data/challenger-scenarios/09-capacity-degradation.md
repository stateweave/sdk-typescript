---
id: capacity-degradation-009
title: Gradual capacity degradation program
tldr: Tests whether an agent can diagnose and remediate a slow reliability decline across weeks of evidence without anchoring on the first plausible cause.
domain: operations-and-reliability
estimated_turns: 8
status: calibration
---

# Gradual capacity degradation program

## TL;DR

A service has worsening tail latency and periodic queue saturation rather than one clean outage. The agent must maintain hypotheses, choose discriminating experiments, plan safe capacity work, and verify that remediation improves customer outcomes.

## Why this scenario exists

Gradual degradation invites anchoring because several plausible causes move together. This scenario rewards discriminating experiments, representative load evidence, and explicit causal updates instead of a polished narrative built around the first available dashboard correlation.

## Private situation

Traffic, tenant mix, payload size, indexing, and retry volume all changed. Dashboards aggregate away important cohorts. A costly hardware increase would hide but not necessarily solve the issue.

## Canonical request sequence

### Turn 1 — Baseline

> Build a degradation timeline, service-level view, hypothesis register, and minimum observability plan from the supplied metrics and change history.

### Turn 2 — Experiments

> Choose the highest-information diagnostics and explain what result would support or weaken each leading hypothesis.

### Turn 3 — Cohorts

> New data shows latency is concentrated in large-tenant writes with attachments. Update priorities and immediate safeguards.

### Turn 4 — Correction

> Correction: the apparent traffic doubling was a dashboard unit migration; request count rose only 18%. Correct the timeline and capacity model.

### Turn 5 — Remediation

> Design the smallest safe remediation across application, queue, database, and capacity controls. Include rollback and overload behavior.

### Turn 6 — Load validation

> Create a representative load and failure test that preserves tenant/payload distributions and does not rely only on average latency.

### Turn 7 — Rollout

> Roll out gradually with guardrails, compare cohorts, and decide whether additional capacity is justified.

### Turn 8 — Program close

> Produce the final causal evidence, changes, SLO results, remaining risks, capacity forecast, and prevention backlog.

## Hidden acceptance criteria

- Unit correction removes the false traffic-doubling claim everywhere.
- Tail latency and queue age matter more than averages alone.
- Tests represent tenant and attachment distributions.
- Overload behavior is bounded and protects existing work.
- Correlation is not promoted to root cause without discriminating evidence.
- Capacity forecast states growth and efficiency assumptions.
- Rollout decisions use predeclared guardrails.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Recalculate capacity using corrected request units.
- Replay representative and adversarial payload distributions.
- Trigger saturation and observe admission control and recovery.
- Compare p50/p95/p99, queue age, errors, and customer cohorts.
- Search final artifacts for stale dashboard interpretations.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Diagnostic rigor: 25
- Correction integrity: 15
- Remediation safety: 20
- Representative verification: 20
- Capacity planning: 10
- Operational clarity: 10

## Challenger notes

- Reward experiments that distinguish hypotheses. Penalize expensive scaling presented as proof of diagnosis.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
