---
id: experiment-analysis-011
title: Product experiment with metric conflict
tldr: Tests whether an agent can analyze a product experiment when assignment, attrition, novelty, and conflicting metrics complicate the headline result.
domain: data-analysis-and-forecasting
estimated_turns: 8
status: draft
---

# Product experiment with metric conflict

## TL;DR

An apparently successful experiment improves engagement but worsens retention for a subgroup. Across eight turns, the agent must validate randomization, preserve a predeclared analysis, handle corrections, and make a proportionate launch decision.

## Why this scenario exists

Product experiments frequently contain integrity problems that are less visible than their headline lift. This scenario tests whether an agent protects a predeclared decision from exposure bias, differential missingness, exploratory subgroup certainty, and a later correction to the event stream.

## Private situation

The experiment changes onboarding. Exposure logs, assignment logs, events, and account outcomes are available. Some users crossed devices, and a logging defect affects one day.

## Canonical request sequence

### Turn 1 — Analysis plan

> Define population, assignment unit, primary/guardrail metrics, exclusions, estimand, and validity checks before looking at treatment effects.

### Turn 2 — Integrity

> Validate sample ratio, exposure, missingness, cross-device assignment, and event consistency. Report issues before outcomes.

### Turn 3 — Results

> Estimate effects with uncertainty and practical significance for primary and guardrail metrics.

### Turn 4 — Correction

> Correction: the day-three event outage affected treatment twice as often because rollout regions differed. Rework affected metrics and conclusions.

### Turn 5 — Heterogeneity

> Investigate the retention decline among small teams without turning exploratory slices into confirmed effects.

### Turn 6 — Mechanism

> Use available funnel and interview evidence to distinguish novelty from a durable mechanism.

### Turn 7 — Decision

> Recommend launch, stop, iterate, or targeted follow-up with explicit thresholds and reversibility.

### Turn 8 — Readout

> Produce the final reproducible analysis, integrity findings, correction changelog, decision, and next experiment.

## Hidden acceptance criteria

- Assignment, exposure, and analysis populations are distinct.
- Sample-ratio mismatch and differential missingness are tested.
- Day-three correction changes affected estimates.
- Guardrails cannot be hidden by the engagement lift.
- Subgroup findings receive multiplicity/uncertainty caveats.
- Recommendation distinguishes statistical from practical significance.
- Final artifacts preserve the predeclared analysis and deviations.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Recompute effects from assignment-level data.
- Simulate the logging outage adjustment.
- Compare intent-to-treat and exposed-user estimates.
- Test sensitivity to missing outcomes and cross-device contamination.
- Trace every launch threshold to the decision section.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Experimental validity: 30
- Correction handling: 15
- Statistical calibration: 15
- Guardrail/subgroup judgment: 15
- Decision quality: 15
- Reproducibility: 10

## Challenger notes

- Judge whether the analysis protects decisions from attractive but invalid headline metrics.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
