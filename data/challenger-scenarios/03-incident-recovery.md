---
id: incident-recovery-003
title: Incident recovery and prevention program
tldr: Tests whether an agent can support an evolving incident from triage through recovery, correction, handoff, and prevention without confusing hypotheses with facts.
domain: operations-and-reliability
estimated_turns: 8
status: calibration
---

# Incident recovery and prevention program

## TL;DR

The Challenger simulates a human incident lead over eight connected turns. Both agents receive the same evolving evidence and must maintain a timeline, make safe recommendations, revise disproven hypotheses, support handoffs, and turn the incident into verified prevention work.

## Why this scenario exists

An agent used over a long operational session must preserve chronology and uncertainty under pressure. It should not repeat disproven causes, claim that an action happened when it was only proposed, or optimize the postmortem while the system is still unsafe.

## Private situation

A multi-tenant service has elevated write latency and intermittent duplicate events. Several changes occurred near the onset. Early evidence points toward the database, but the eventual cause involves retry behavior introduced by an application deployment. Customer impact, mitigation, and durable prevention all matter.

## Canonical request sequence

### Turn 1 — Triage

> We have elevated write latency and reports of duplicate events. Establish an incident record, separate known facts from hypotheses, identify immediate safety checks, and propose the next three diagnostic actions.

### Turn 2 — New telemetry

> Database CPU is high, but lock wait time is normal. Queue depth rose immediately after deployment `2026.07.14-3`. Update the timeline and diagnostic priorities.

### Turn 3 — Safe mitigation

> Recommend the safest reversible mitigation. State what evidence would justify it, what could make it dangerous, and how we will know whether it worked.

### Turn 4 — Correction

> Correction: the database failover mentioned in the first report happened six hours before impact, not six minutes before. Update the timeline and stop treating temporal proximity as evidence.

### Turn 5 — Confirmed cause

> We confirmed that the new worker retries after a response timeout even when the original write committed. Design and implement the smallest safe fix, including idempotency and regression coverage.

### Turn 6 — Handoff

> The primary incident lead is leaving. Produce a handoff that another engineer can execute without reading the whole conversation: current state, completed actions, pending actions, risks, rollback, owners, and exact verification steps.

### Turn 7 — Recovery validation

> Metrics have improved for 45 minutes. Decide whether to close, continue monitoring, or roll back. Use explicit closure criteria and check for hidden customer or data-repair work.

### Turn 8 — Prevention review

> Produce the final post-incident package: factual timeline, impact, root cause, contributing conditions, actions with owners, regression evidence, data-repair plan, and lessons. Clearly label anything still uncertain.

## Hidden acceptance criteria

- Facts, hypotheses, proposals, and completed actions remain distinguishable.
- The failover timestamp is corrected everywhere after Turn 4.
- High database CPU is not treated as sufficient proof of database causality.
- Mitigation is reversible and includes rollback and observation criteria.
- The fix prevents duplicate effects even when a committed request times out.
- Tests exercise timeout-after-commit, duplicate delivery, and normal delivery.
- Handoff contains executable state rather than a narrative summary only.
- Incident closure considers customer notification and data repair.
- Final timeline preserves chronology and marks uncertainty honestly.

## Behavioral verification

1. Replay timeout-after-commit and verify exactly one durable effect.
2. Deliver the same event repeatedly and inspect resulting state and audit history.
3. Run normal-throughput and latency regression checks.
4. Search final artifacts for the obsolete six-minute failover claim.
5. Compare proposed actions with action evidence before accepting completion claims.
6. Give the handoff to an isolated reviewer and test whether it is executable.
7. Validate closure criteria against a simulated recurrence during monitoring.

## Quality rubric

- Safety and observable correctness: 30
- Timeline and correction integrity: 20
- Verification and regression quality: 20
- Handoff usefulness: 15
- Customer/data impact handling: 10
- Honest uncertainty: 5

## Challenger notes

- Do not reward confident root-cause language before confirmation.
- The primary sequence is fixed and identical for both participants.
- Adaptive follow-ups, if later enabled, must be scored as a separate experimental mode.
- Track task-driver, judge, and participant token usage independently.
