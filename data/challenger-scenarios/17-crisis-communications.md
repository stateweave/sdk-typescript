---
id: crisis-communications-017
title: Evolving service-incident communications
tldr: Tests whether an agent can communicate during a crisis as facts change, avoiding speculation, contradiction, and premature closure.
domain: writing-and-stakeholder-communication
estimated_turns: 8
status: draft
---

# Evolving service-incident communications

## TL;DR

The agent maintains internal, customer, executive, and public communications during a service disruption. It must preserve factual consistency while tailoring detail, correcting errors, and avoiding promises unsupported by operations.

## Private situation

A payment service is intermittently failing. Impact scope and cause are initially uncertain. Updates must be timely, but legal and support teams need different detail than a public status page.

## Canonical request sequence

1. **Framework:** > Create a communication cadence, audience map, approval path, factual source of truth, and first holding messages from the known incident facts.
2. **Update:** > Evidence now shows elevated failures in two regions, with no confirmed data loss. Draft audience-specific updates and list unresolved questions.
3. **Correction:** > Correction: the first dashboard undercounted mobile failures. Total affected transactions are approximately 2.4 times the initial estimate. Correct all active narratives.
4. **Cause uncertainty:** > Engineers have a leading hypothesis but no confirmation. Communicate progress without presenting the hypothesis as root cause.
5. **Mitigation:** > A mitigation reduced errors but increased latency. Draft updates that explain customer impact and next checks accurately.
6. **Recovery:** > Error rates are normal for 30 minutes. Prepare monitoring-stage communications and closure criteria without declaring final resolution early.
7. **Resolution:** > Closure criteria are met. Produce final customer, executive, support, and status-page messages with consistent scope and timing.
8. **Post-incident:** > Write the communication retrospective, correction log, template improvements, and commitments that have explicit owners.

## Hidden acceptance criteria

- Mobile undercount correction appears everywhere after Turn 3.
- No-data-loss language remains qualified until evidence supports it.
- Hypothesis and confirmed cause never blur.
- Mitigation tradeoff is communicated honestly.
- Audience detail varies without changing core facts.
- Resolution waits for declared closure criteria.
- Commitments have owners and are not invented.

## Behavioral verification

- Compare dates, scope, impact, and status across every audience artifact.
- Search for stale initial impact estimates.
- Classify each causal statement as confirmed, likely, or unknown.
- Simulate a customer reading sequential updates for contradiction.
- Verify final commitments against the action register.

## Quality rubric

Factual consistency 30; correction handling 20; uncertainty discipline 15; audience adaptation 15; operational timing 10; clarity 10.

## Challenger notes

Faster prose is not better if it outruns incident evidence.
