---
id: capacity-degradation-009
title: Gradual capacity degradation program
tldr: Tests whether an agent can diagnose and remediate a slow reliability decline across weeks of evidence without anchoring on the first plausible cause.
domain: operations-and-reliability
estimated_turns: 8
status: draft
---

# Gradual capacity degradation program

## TL;DR

A service has worsening tail latency and periodic queue saturation rather than one clean outage. The agent must maintain hypotheses, choose discriminating experiments, plan safe capacity work, and verify that remediation improves customer outcomes.

## Private situation

Traffic, tenant mix, payload size, indexing, and retry volume all changed. Dashboards aggregate away important cohorts. A costly hardware increase would hide but not necessarily solve the issue.

## Canonical request sequence

1. **Baseline:** > Build a degradation timeline, service-level view, hypothesis register, and minimum observability plan from the supplied metrics and change history.
2. **Experiments:** > Choose the highest-information diagnostics and explain what result would support or weaken each leading hypothesis.
3. **Cohorts:** > New data shows latency is concentrated in large-tenant writes with attachments. Update priorities and immediate safeguards.
4. **Correction:** > Correction: the apparent traffic doubling was a dashboard unit migration; request count rose only 18%. Correct the timeline and capacity model.
5. **Remediation:** > Design the smallest safe remediation across application, queue, database, and capacity controls. Include rollback and overload behavior.
6. **Load validation:** > Create a representative load and failure test that preserves tenant/payload distributions and does not rely only on average latency.
7. **Rollout:** > Roll out gradually with guardrails, compare cohorts, and decide whether additional capacity is justified.
8. **Program close:** > Produce the final causal evidence, changes, SLO results, remaining risks, capacity forecast, and prevention backlog.

## Hidden acceptance criteria

- Unit correction removes the false traffic-doubling claim everywhere.
- Tail latency and queue age matter more than averages alone.
- Tests represent tenant and attachment distributions.
- Overload behavior is bounded and protects existing work.
- Correlation is not promoted to root cause without discriminating evidence.
- Capacity forecast states growth and efficiency assumptions.
- Rollout decisions use predeclared guardrails.

## Behavioral verification

- Recalculate capacity using corrected request units.
- Replay representative and adversarial payload distributions.
- Trigger saturation and observe admission control and recovery.
- Compare p50/p95/p99, queue age, errors, and customer cohorts.
- Search final artifacts for stale dashboard interpretations.

## Quality rubric

Diagnostic rigor 25; correction integrity 15; remediation safety 20; representative verification 20; capacity planning 10; operational clarity 10.

## Challenger notes

Reward experiments that distinguish hypotheses. Penalize expensive scaling presented as proof of diagnosis.
