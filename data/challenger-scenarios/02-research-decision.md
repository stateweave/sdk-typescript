---
id: research-decision-002
title: Evidence-backed market entry decision
tldr: Tests whether an agent can maintain a defensible research decision as evidence, assumptions, and executive priorities change over one long session.
domain: research-and-strategy
estimated_turns: 7
status: draft
---

# Evidence-backed market entry decision

## TL;DR

The Challenger behaves like an executive preparing a market-entry decision. Across seven turns, both agents must maintain a source ledger, separate facts from assumptions, revise conclusions when evidence changes, and produce a decision package without silently carrying obsolete claims forward.

## Why this scenario exists

Long-running knowledge work fails when an agent remembers the headline but loses provenance, contradictions, dates, or corrections. This scenario evaluates whether the agent remains useful as the decision evolves rather than merely writing persuasive prose.

## Private situation

A software company is considering entry into a regulated regional market. The available material includes interview notes, market estimates, legal summaries, pricing spreadsheets, and two later corrections. Some sources disagree. The correct outcome is not predetermined; the quality of the evidence chain and revision discipline matters most.

## Canonical request sequence

### Turn 1 — Establish the research system

> We are evaluating entry into the Northstar market. Review the provided materials, create a source and assumption ledger, identify important unknowns, and propose a research plan. Do not recommend go or no-go yet.

### Turn 2 — Initial synthesis

> Produce an initial market view covering demand, buyer, competition, pricing, regulatory exposure, and operational requirements. Show confidence and provenance for consequential claims.

### Turn 3 — Decision model

> Build a decision model with explicit assumptions, downside cases, reversible versus irreversible commitments, and measurable thresholds for a pilot.

### Turn 4 — Evidence correction

> New information: the previously quoted 18% annual growth figure included an adjacent consumer category. The relevant enterprise segment grew 7%. Correct the analysis and identify every conclusion affected by that change.

### Turn 5 — Priority shift

> Leadership now values a low-regret learning option over maximum first-year revenue. Re-evaluate the options without discarding the original financial analysis.

### Turn 6 — Adversarial review

> Act as a skeptical investment committee. Find unsupported claims, stale assumptions, hidden dependencies, and ways the proposed pilot could produce misleading evidence. Then revise the recommendation where necessary.

### Turn 7 — Executive package

> Deliver the final decision package: recommendation, confidence, evidence table, unresolved risks, pilot design, stop/go thresholds, owners, and a changelog showing how the recommendation evolved.

## Hidden acceptance criteria

- Every consequential numeric claim has a source or is explicitly marked as an assumption.
- Source date and reliability are represented.
- The 18% figure is marked obsolete after Turn 4 and is not reused as current evidence.
- The 7% correction propagates into forecasts and narrative conclusions.
- Original financial analysis remains available after the priority shift.
- Recommendation changes are explained rather than silently overwritten.
- Unknowns are not converted into invented facts.
- The pilot has measurable outcomes and precommitted stop/go thresholds.
- Final output distinguishes evidence, inference, decision, and open question.

## Behavioral verification

1. Search the final artifacts for the stale 18% claim presented as current.
2. Trace each material forecast input to a source or labelled assumption.
3. Compare the Turn 3 and Turn 7 decision models for an explicit change record.
4. Check whether the low-regret objective changed option ranking coherently.
5. Test the pilot thresholds against optimistic, base, and downside examples.
6. Ask a surprise recall question about an early source caveat after Turn 7.

## Quality rubric

- Evidence fidelity and provenance: 30
- Correction propagation: 20
- Decision usefulness: 20
- Long-horizon memory and changelog quality: 15
- Uncertainty calibration: 10
- Communication quality: 5

## Challenger notes

- The Challenger owns the private source bundle and gold corrections.
- Judge both answers anonymously and randomize A/B presentation.
- Prefer checkable evidence links and artifact consistency over rhetorical confidence.
- Track Challenger research and judging tokens independently.
