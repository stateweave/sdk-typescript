---
id: demand-forecast-010
title: Demand forecast with structural break
tldr: Tests whether an agent can maintain a forecast when seasonality, promotions, stockouts, and a later structural break complicate historical data.
domain: data-analysis-and-forecasting
estimated_turns: 7
status: draft
---

# Demand forecast with structural break

## TL;DR

The Challenger asks both agents to build and revise an operational demand forecast. The task tests data validation, leakage avoidance, uncertainty, correction propagation, and whether the final forecast supports inventory decisions rather than merely fitting history.

## Why this scenario exists

Operational forecasts are only useful when their data transformations, validation windows, and decision costs remain defensible. This scenario tests whether the agent can correct historical features and censored observations without preserving attractive but invalid accuracy claims.

## Private situation

Three years of weekly demand include promotions, stockouts that censor observed sales, channel launches, and a pricing change. A warehouse decision depends on peak demand and downside risk.

## Canonical request sequence

### Turn 1 — Audit

> Inspect the demand data, define the forecast target and horizon, identify leakage/censoring risks, and propose validation before modeling.

### Turn 2 — Baseline

> Build an interpretable baseline with backtesting, uncertainty intervals, and an error breakdown by season and channel.

### Turn 3 — Stockouts

> Correct for weeks where observed sales were capped by unavailable inventory. Show assumptions rather than treating imputed demand as fact.

### Turn 4 — Correction

> Correction: promotion flags were recorded one week late before 2025. Repair feature alignment and identify every reported metric affected.

### Turn 5 — Structural break

> A permanent price increase changed conversion last quarter. Evaluate whether old history remains representative and revise the model.

### Turn 6 — Decision

> Convert the forecast into inventory and warehouse recommendations under service-level and holding-cost tradeoffs.

### Turn 7 — Final review

> Deliver reproducible data checks, backtests, forecast ranges, scenario sensitivities, decision thresholds, and limitations.

## Hidden acceptance criteria

- Training features do not contain future information.
- Stockout-censored sales are not treated as unconstrained demand.
- Promotion alignment correction triggers metric and model recomputation.
- Validation respects temporal ordering.
- Structural break is tested rather than assumed away.
- Decision output uses uncertainty and asymmetric costs.
- Reproducible artifacts separate raw, corrected, and modeled data.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Inject future-leaking features and confirm safeguards detect them.
- Re-run backtests before and after promotion correction.
- Compare naive seasonal, corrected, and structural-break models.
- Stress recommendations across service-level and holding-cost assumptions.
- Reproduce final figures from stored transformations.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Data integrity: 25
- Validation and leakage control: 20
- Correction propagation: 15
- Forecast calibration: 15
- Decision usefulness: 15
- Reproducibility: 10

## Challenger notes

- Do not score model sophistication directly. A simple calibrated model can beat a complex unsupported one.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
