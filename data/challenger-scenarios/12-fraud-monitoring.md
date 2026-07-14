---
id: fraud-monitoring-012
title: Fraud monitoring threshold redesign
tldr: Tests whether an agent can redesign a risk threshold while accounting for delayed labels, asymmetric costs, drift, fairness, and operations capacity.
domain: data-analysis-and-forecasting
estimated_turns: 7
status: draft
---

# Fraud monitoring threshold redesign

## TL;DR

The Challenger asks agents to improve a fraud alerting program without optimizing a single offline metric. The analysis must connect model behavior to reviewer capacity, customer friction, delayed outcomes, and monitoring.

## Private situation

Current alerts overwhelm investigators. Chargeback labels arrive weeks late, some confirmed fraud never becomes a chargeback, and one customer segment experiences disproportionate false positives.

## Canonical request sequence

1. **Frame:** > Define the decision, costs, label limitations, operational constraints, and evaluation plan before proposing a threshold.
2. **Baseline:** > Audit current precision, recall, calibration, alert volume, review delay, and segment outcomes using time-based validation.
3. **Capacity:** > Design threshold options that fit investigator capacity and quantify expected missed fraud and customer friction.
4. **Correction:** > Correction: last quarter's chargeback export omitted reversals, inflating positive labels by 12%. Repair labels and propagate the impact.
5. **Fairness:** > Investigate the segment false-positive disparity, plausible causes, and safe mitigations without erasing legitimate risk differences.
6. **Rollout:** > Propose shadow evaluation, staged thresholds, escalation, drift monitoring, and rollback triggers.
7. **Decision package:** > Deliver threshold recommendation, cost scenarios, segment analysis, monitoring contract, and unresolved label risk.

## Hidden acceptance criteria

- Temporal validation respects delayed labels.
- Reversal correction changes prevalence and reported metrics.
- Alert capacity is a hard operational constraint.
- Calibration and cost tradeoffs accompany precision/recall.
- Segment analysis reports both error rates and uncertainty.
- Shadow mode cannot affect customers.
- Drift and delayed performance are monitored after rollout.

## Behavioral verification

- Rebuild labels with reversals and rerun metrics.
- Backtest thresholds across multiple time windows.
- Simulate alert queues at capacity and surge volumes.
- Compare customer impact and fraud loss by segment.
- Trigger rollback conditions in a staged simulation.

## Quality rubric

Label/data integrity 25; cost and capacity reasoning 20; correction propagation 15; fairness analysis 15; rollout/monitoring 15; decision clarity 10.

## Challenger notes

Do not accept an offline AUC improvement as a complete operational recommendation.
