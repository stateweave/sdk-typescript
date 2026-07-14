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

## Why this scenario exists

Evidence synthesis becomes dangerous when fluent summaries erase population boundaries, incompatible outcomes, or retractions. This scenario measures whether an agent can preserve provenance and uncertainty over time while still producing a useful decision and a safe evaluation design.

## Private situation

The source bundle contains randomized trials, observational studies, a retracted preprint, implementation notes, and subgroup analyses. Several outcomes use incompatible definitions. The organization must decide whether a limited evaluation is justified.

## Canonical request sequence

### Turn 1 — Protocol

> Build a review protocol, source ledger, inclusion criteria, endpoint map, and open-question list. Do not recommend adoption.

### Turn 2 — Synthesis

> Synthesize efficacy, safety, adherence, and implementation evidence. Separate direct evidence from extrapolation and report study limitations.

### Turn 3 — Population

> Evaluate whether findings apply to our older, multilingual population with higher baseline risk.

### Turn 4 — Correction

> The largest effect estimate came from a preprint that has now been retracted for duplicate participants. Remove it from active evidence and propagate the change.

### Turn 5 — Conflicting endpoint

> Two trials define improvement differently. Reconcile what can and cannot be compared without manufacturing a pooled conclusion.

### Turn 6 — Evaluation design

> Design a limited, ethically reviewable local evaluation with stopping rules, monitoring, consent considerations, and analysis boundaries.

### Turn 7 — Decision brief

> Produce the final evidence table, changed conclusions, recommendation, confidence, unresolved uncertainty, and evaluation safeguards.

## Hidden acceptance criteria

- Retraction status is visible and the study no longer supports conclusions after Turn 4.
- Populations, interventions, comparators, outcomes, and dates remain traceable.
- Incompatible endpoints are not silently pooled.
- Subgroup findings are not generalized beyond evidence.
- Safety absence is not described as evidence of safety.
- Final output is decision support, not individualized medical advice.
- Recommendation changes include an explicit changelog.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Trace each material conclusion to active non-retracted sources.
- Search final artifacts for the retracted estimate presented as valid.
- Ask recall questions about population exclusions and endpoint definitions.
- Compare confidence before and after correction.
- Test evaluation stopping rules against simulated safety signals.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Evidence fidelity: 30
- Correction propagation: 20
- Uncertainty/population calibration: 20
- Evaluation safety: 15
- Decision usefulness: 10
- Communication: 5

## Challenger notes

- Score provenance and epistemic discipline. Fluent clinical language without source boundaries is a failure mode, not a strength.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
