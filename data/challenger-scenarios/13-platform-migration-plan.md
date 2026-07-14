---
id: platform-migration-plan-013
title: Cross-team platform migration
tldr: Tests whether an agent can coordinate a multi-quarter migration with dependencies, ownership, changing constraints, and measurable exit criteria.
domain: project-planning-and-coordination
estimated_turns: 8
status: draft
---

# Cross-team platform migration

## TL;DR

The Challenger simulates a program sponsor migrating six teams from a legacy platform. The agent must maintain an executable plan, reconcile dependencies and capacity, respond to corrections, and preserve accountability across a long session.

## Private situation

The legacy platform is expensive but stable. Teams have different readiness, contractual blackout periods, and shared dependencies. Leadership wants a date, but sequencing and rollback evidence matter more than optimistic certainty.

## Canonical request sequence

1. **Discovery:** > Build a migration inventory, stakeholder map, dependency graph, assumptions, unknowns, and readiness criteria. Do not promise a final date yet.
2. **Plan:** > Propose waves, milestones, owners, capacity assumptions, critical path, decision points, and rollback requirements.
3. **Constraint:** > Team Delta cannot migrate during its eight-week regulatory blackout. Re-sequence without silently moving risk to dependent teams.
4. **Correction:** > Correction: the shared identity service will not be ready in Q2; its committed date is mid-Q3. Update every affected milestone and forecast.
5. **Pilot:** > Define a representative pilot, entry/exit criteria, support model, and evidence required before the next wave.
6. **Slippage:** > The pilot is three weeks late and consumed twice the expected platform support. Reforecast capacity and communicate options.
7. **Governance:** > Create the operating cadence, risk escalation, change control, status definitions, and executive reporting contract.
8. **Baseline:** > Deliver the final integrated plan, critical path, dependencies, resource profile, decision log, contingency paths, and confidence range.

## Hidden acceptance criteria

- The identity-service correction propagates to all dependent waves.
- Regulatory blackout is a hard constraint.
- Owners and decision dates accompany major dependencies.
- Pilot evidence gates later waves.
- Reforecast incorporates observed support consumption.
- Status distinguishes forecast, commitment, and aspiration.
- Rollback and coexistence are planned, not implied.

## Behavioral verification

- Traverse the dependency graph for impossible dates.
- Compare resource demand with stated team capacity.
- Apply correction and slippage events to the critical path.
- Test pilot failure and identity-service delay contingencies.
- Ask isolated reviewers to identify current owner and next decision for each risk.

## Quality rubric

Plan coherence 25; dependency/correction integrity 20; resource realism 15; governance 15; contingency quality 15; communication 10.

## Challenger notes

Reward plans that remain executable after disruption. Penalize polished timelines with impossible dependencies.
