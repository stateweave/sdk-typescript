---
id: vendor-risk-020
title: Critical vendor risk assessment
tldr: Tests whether an agent can maintain a risk decision as security evidence, contract terms, service dependencies, and remediation commitments evolve.
domain: compliance-policy-and-risk
estimated_turns: 7
status: held-out
---

# Critical vendor risk assessment

## TL;DR

A proposed vendor will process sensitive customer data and sit on a critical path. The agent must organize evidence, identify gaps, propose proportionate controls, revise after corrections, and support an accountable approval decision.

## Why this scenario exists

Vendor assessment is vulnerable to evidence laundering, where broad reports or sales claims are treated as proof for a specific product. This scenario tests whether the agent can maintain scope discipline, make conditions enforceable, and connect residual risk to authorized owners and exit behavior.

## Private situation

Available evidence includes questionnaires, audit reports, architecture diagrams, incident history, contract drafts, and sales claims. Some controls are inherited from subprocessors. A deadline creates pressure to approve open risks without owners.

## Canonical request sequence

### Turn 1 — Scope

> Define service/data scope, dependency criticality, evidence requirements, decision owners, risk criteria, and open questions before scoring the vendor.

### Turn 2 — Assessment

> Assess security, privacy, resilience, access, data lifecycle, subprocessors, incident response, and exit risk with evidence confidence.

### Turn 3 — Contract

> Map material risks to contract terms, technical controls, monitoring, and accountable remediation rather than generic recommendations.

### Turn 4 — Correction

> Correction: the cited SOC 2 report covers the parent company but excludes the product and hosting environment we would use. Reassess every reliance on it.

### Turn 5 — Resilience

> Evaluate a 12-hour vendor outage, regional loss, and vendor insolvency. Define continuity, data access, and exit tests.

### Turn 6 — Remediation claim

> The vendor promises key controls in 90 days. Decide what can be conditional, what blocks launch, and what evidence closes each item.

### Turn 7 — Decision

> Deliver approve/conditional/reject options, residual risks, owners, contract conditions, monitoring, exit plan, and evidence changelog.

## Hidden acceptance criteria

- Out-of-scope audit report no longer supports product controls after Turn 4.
- Sales statements remain lower-confidence than independent evidence.
- Risks connect to owners, deadlines, closure evidence, and consequences.
- Conditional approval cannot silently become permanent exception.
- Continuity and exit are tested, not documented only.
- Subprocessor responsibilities are explicit.
- Residual risk acceptance has an authorized owner.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Trace each high-risk rating to in-scope evidence.
- Simulate outage, region loss, and contract termination.
- Review remediation closure artifacts against promised controls.
- Search final assessment for stale SOC 2 reliance.
- Test monitoring and escalation after missed deadlines.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Evidence scope/integrity: 25
- Risk judgment: 20
- Correction propagation: 15
- Mitigation accountability: 15
- Resilience/exit: 15
- Decision clarity: 10

## Challenger notes

- The benchmark has no preferred approve/reject outcome. Unsupported certainty and ownerless conditions are failures.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
