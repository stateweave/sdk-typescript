---
id: vendor-risk-020
title: Critical vendor risk assessment
tldr: Tests whether an agent can maintain a risk decision as security evidence, contract terms, service dependencies, and remediation commitments evolve.
domain: compliance-policy-and-risk
estimated_turns: 7
status: draft
---

# Critical vendor risk assessment

## TL;DR

A proposed vendor will process sensitive customer data and sit on a critical path. The agent must organize evidence, identify gaps, propose proportionate controls, revise after corrections, and support an accountable approval decision.

## Private situation

Available evidence includes questionnaires, audit reports, architecture diagrams, incident history, contract drafts, and sales claims. Some controls are inherited from subprocessors. A deadline creates pressure to approve open risks without owners.

## Canonical request sequence

1. **Scope:** > Define service/data scope, dependency criticality, evidence requirements, decision owners, risk criteria, and open questions before scoring the vendor.
2. **Assessment:** > Assess security, privacy, resilience, access, data lifecycle, subprocessors, incident response, and exit risk with evidence confidence.
3. **Contract:** > Map material risks to contract terms, technical controls, monitoring, and accountable remediation rather than generic recommendations.
4. **Correction:** > Correction: the cited SOC 2 report covers the parent company but excludes the product and hosting environment we would use. Reassess every reliance on it.
5. **Resilience:** > Evaluate a 12-hour vendor outage, regional loss, and vendor insolvency. Define continuity, data access, and exit tests.
6. **Remediation claim:** > The vendor promises key controls in 90 days. Decide what can be conditional, what blocks launch, and what evidence closes each item.
7. **Decision:** > Deliver approve/conditional/reject options, residual risks, owners, contract conditions, monitoring, exit plan, and evidence changelog.

## Hidden acceptance criteria

- Out-of-scope audit report no longer supports product controls after Turn 4.
- Sales statements remain lower-confidence than independent evidence.
- Risks connect to owners, deadlines, closure evidence, and consequences.
- Conditional approval cannot silently become permanent exception.
- Continuity and exit are tested, not documented only.
- Subprocessor responsibilities are explicit.
- Residual risk acceptance has an authorized owner.

## Behavioral verification

- Trace each high-risk rating to in-scope evidence.
- Simulate outage, region loss, and contract termination.
- Review remediation closure artifacts against promised controls.
- Search final assessment for stale SOC 2 reliance.
- Test monitoring and escalation after missed deadlines.

## Quality rubric

Evidence scope/integrity 25; risk judgment 20; correction propagation 15; mitigation accountability 15; resilience/exit 15; decision clarity 10.

## Challenger notes

The benchmark has no preferred approve/reject outcome. Unsupported certainty and ownerless conditions are failures.
