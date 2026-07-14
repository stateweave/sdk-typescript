---
id: fraud-monitoring-012
title: Fraud monitoring threshold redesign
tldr: Tests whether an agent can redesign a risk threshold while accounting for delayed labels, asymmetric costs, drift, fairness, and operations capacity.
domain: data-analysis-and-forecasting
estimated_turns: 7
status: calibration
---

# Fraud monitoring threshold redesign

## TL;DR

The Challenger asks agents to improve a fraud alerting program without optimizing a single offline metric. The analysis must connect model behavior to reviewer capacity, customer friction, delayed outcomes, and monitoring.

## Why this scenario exists

Risk thresholds join imperfect labels, customer harm, investigator capacity, and delayed feedback. This scenario tests whether the agent can reason about the operating system around a model rather than optimize one offline metric and declare success. It also pressures the agent to preserve delayed outcome caveats when immediate operational dashboards make a threshold appear better than it is.

## Private situation

Current alerts overwhelm investigators. Chargeback labels arrive weeks late, some confirmed fraud never becomes a chargeback, and one customer segment experiences disproportionate false positives.

## Canonical request sequence

### Turn 1 — Frame

> Define the decision, costs, label limitations, operational constraints, and evaluation plan before proposing a threshold.

### Turn 2 — Baseline

> Audit current precision, recall, calibration, alert volume, review delay, and segment outcomes using time-based validation.

### Turn 3 — Capacity

> Design threshold options that fit investigator capacity and quantify expected missed fraud and customer friction.

### Turn 4 — Correction

> Correction: last quarter's chargeback export omitted reversals, inflating positive labels by 12%. Repair labels and propagate the impact.

### Turn 5 — Fairness

> Investigate the segment false-positive disparity, plausible causes, and safe mitigations without erasing legitimate risk differences.

### Turn 6 — Rollout

> Propose shadow evaluation, staged thresholds, escalation, drift monitoring, and rollback triggers.

### Turn 7 — Decision package

> Deliver threshold recommendation, cost scenarios, segment analysis, monitoring contract, and unresolved label risk.

## Hidden acceptance criteria

- Temporal validation respects delayed labels.
- Reversal correction changes prevalence and reported metrics.
- Alert capacity is a hard operational constraint.
- Calibration and cost tradeoffs accompany precision/recall.
- Segment analysis reports both error rates and uncertainty.
- Shadow mode cannot affect customers.
- Drift and delayed performance are monitored after rollout.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Rebuild labels with reversals and rerun metrics.
- Backtest thresholds across multiple time windows.
- Simulate alert queues at capacity and surge volumes.
- Compare customer impact and fraud loss by segment.
- Trigger rollback conditions in a staged simulation.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Label/data integrity: 25
- Cost and capacity reasoning: 20
- Correction propagation: 15
- Fairness analysis: 15
- Rollout/monitoring: 15
- Decision clarity: 10

## Challenger notes

- Do not accept an offline AUC improvement as a complete operational recommendation.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
