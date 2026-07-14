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

## Private situation

Three years of weekly demand include promotions, stockouts that censor observed sales, channel launches, and a pricing change. A warehouse decision depends on peak demand and downside risk.

## Canonical request sequence

1. **Audit:** > Inspect the demand data, define the forecast target and horizon, identify leakage/censoring risks, and propose validation before modeling.
2. **Baseline:** > Build an interpretable baseline with backtesting, uncertainty intervals, and an error breakdown by season and channel.
3. **Stockouts:** > Correct for weeks where observed sales were capped by unavailable inventory. Show assumptions rather than treating imputed demand as fact.
4. **Correction:** > Correction: promotion flags were recorded one week late before 2025. Repair feature alignment and identify every reported metric affected.
5. **Structural break:** > A permanent price increase changed conversion last quarter. Evaluate whether old history remains representative and revise the model.
6. **Decision:** > Convert the forecast into inventory and warehouse recommendations under service-level and holding-cost tradeoffs.
7. **Final review:** > Deliver reproducible data checks, backtests, forecast ranges, scenario sensitivities, decision thresholds, and limitations.

## Hidden acceptance criteria

- Training features do not contain future information.
- Stockout-censored sales are not treated as unconstrained demand.
- Promotion alignment correction triggers metric and model recomputation.
- Validation respects temporal ordering.
- Structural break is tested rather than assumed away.
- Decision output uses uncertainty and asymmetric costs.
- Reproducible artifacts separate raw, corrected, and modeled data.

## Behavioral verification

- Inject future-leaking features and confirm safeguards detect them.
- Re-run backtests before and after promotion correction.
- Compare naive seasonal, corrected, and structural-break models.
- Stress recommendations across service-level and holding-cost assumptions.
- Reproduce final figures from stored transformations.

## Quality rubric

Data integrity 25; validation and leakage control 20; correction propagation 15; forecast calibration 15; decision usefulness 15; reproducibility 10.

## Challenger notes

Do not score model sophistication directly. A simple calibrated model can beat a complex unsupported one.
