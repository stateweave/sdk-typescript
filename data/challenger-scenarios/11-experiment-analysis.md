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

## Private situation

The experiment changes onboarding. Exposure logs, assignment logs, events, and account outcomes are available. Some users crossed devices, and a logging defect affects one day.

## Canonical request sequence

1. **Analysis plan:** > Define population, assignment unit, primary/guardrail metrics, exclusions, estimand, and validity checks before looking at treatment effects.
2. **Integrity:** > Validate sample ratio, exposure, missingness, cross-device assignment, and event consistency. Report issues before outcomes.
3. **Results:** > Estimate effects with uncertainty and practical significance for primary and guardrail metrics.
4. **Correction:** > Correction: the day-three event outage affected treatment twice as often because rollout regions differed. Rework affected metrics and conclusions.
5. **Heterogeneity:** > Investigate the retention decline among small teams without turning exploratory slices into confirmed effects.
6. **Mechanism:** > Use available funnel and interview evidence to distinguish novelty from a durable mechanism.
7. **Decision:** > Recommend launch, stop, iterate, or targeted follow-up with explicit thresholds and reversibility.
8. **Readout:** > Produce the final reproducible analysis, integrity findings, correction changelog, decision, and next experiment.

## Hidden acceptance criteria

- Assignment, exposure, and analysis populations are distinct.
- Sample-ratio mismatch and differential missingness are tested.
- Day-three correction changes affected estimates.
- Guardrails cannot be hidden by the engagement lift.
- Subgroup findings receive multiplicity/uncertainty caveats.
- Recommendation distinguishes statistical from practical significance.
- Final artifacts preserve the predeclared analysis and deviations.

## Behavioral verification

- Recompute effects from assignment-level data.
- Simulate the logging outage adjustment.
- Compare intent-to-treat and exposed-user estimates.
- Test sensitivity to missing outcomes and cross-device contamination.
- Trace every launch threshold to the decision section.

## Quality rubric

Experimental validity 30; correction handling 15; statistical calibration 15; guardrail/subgroup judgment 15; decision quality 15; reproducibility 10.

## Challenger notes

Judge whether the analysis protects decisions from attractive but invalid headline metrics.
