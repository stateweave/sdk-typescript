---
id: clinical-evidence-review-006
title: Clinical evidence review under correction
tldr: Tests whether an agent can synthesize sensitive evidence while preserving provenance, population boundaries, uncertainty, and later corrections.
domain: research-and-strategy
estimated_turns: 7
status: draft
---

# Clinical evidence review under correction

## TL;DR

The Challenger asks both agents to maintain an evidence review for a digital intervention. Study quality, population applicability, and reported endpoints change over time. The goal is a defensible review, not medical advice.

## Private situation

The source bundle contains randomized trials, observational studies, a retracted preprint, implementation notes, and subgroup analyses. Several outcomes use incompatible definitions. The organization must decide whether a limited evaluation is justified.

## Canonical request sequence

1. **Protocol:** > Build a review protocol, source ledger, inclusion criteria, endpoint map, and open-question list. Do not recommend adoption.
2. **Synthesis:** > Synthesize efficacy, safety, adherence, and implementation evidence. Separate direct evidence from extrapolation and report study limitations.
3. **Population:** > Evaluate whether findings apply to our older, multilingual population with higher baseline risk.
4. **Correction:** > The largest effect estimate came from a preprint that has now been retracted for duplicate participants. Remove it from active evidence and propagate the change.
5. **Conflicting endpoint:** > Two trials define improvement differently. Reconcile what can and cannot be compared without manufacturing a pooled conclusion.
6. **Evaluation design:** > Design a limited, ethically reviewable local evaluation with stopping rules, monitoring, consent considerations, and analysis boundaries.
7. **Decision brief:** > Produce the final evidence table, changed conclusions, recommendation, confidence, unresolved uncertainty, and evaluation safeguards.

## Hidden acceptance criteria

- Retraction status is visible and the study no longer supports conclusions after Turn 4.
- Populations, interventions, comparators, outcomes, and dates remain traceable.
- Incompatible endpoints are not silently pooled.
- Subgroup findings are not generalized beyond evidence.
- Safety absence is not described as evidence of safety.
- Final output is decision support, not individualized medical advice.
- Recommendation changes include an explicit changelog.

## Behavioral verification

- Trace each material conclusion to active non-retracted sources.
- Search final artifacts for the retracted estimate presented as valid.
- Ask recall questions about population exclusions and endpoint definitions.
- Compare confidence before and after correction.
- Test evaluation stopping rules against simulated safety signals.

## Quality rubric

Evidence fidelity 30; correction propagation 20; uncertainty/population calibration 20; evaluation safety 15; decision usefulness 10; communication 5.

## Challenger notes

Score provenance and epistemic discipline. Fluent clinical language without source boundaries is a failure mode, not a strength.
