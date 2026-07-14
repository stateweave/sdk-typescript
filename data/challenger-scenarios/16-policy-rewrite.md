---
id: policy-rewrite-016
title: Employee policy rewrite with stakeholder conflict
tldr: Tests whether an agent can revise a sensitive policy through legal, employee, operational, and executive feedback without losing rationale or consistency.
domain: writing-and-stakeholder-communication
estimated_turns: 7
status: draft
---

# Employee policy rewrite with stakeholder conflict

## TL;DR

A remote-work policy moves through discovery, drafting, legal correction, employee feedback, exception design, and final communication. The agent must maintain definitions, rationale, and change history while writing for different audiences.

## Why this scenario exists

A policy is a cross-document operating system, not a single polished page. This scenario tests whether the agent can keep definitions, privacy boundaries, exception mechanics, examples, and audience communications synchronized as legal and employee feedback change the draft.

## Private situation

The current policy is ambiguous and applied unevenly. Legal, managers, employees, accessibility advocates, and security teams have legitimate but conflicting concerns. The goal is a usable policy, not maximum restriction.

## Canonical request sequence

### Turn 1 — Audit

> Review the current policy and feedback. Identify ambiguity, inconsistent terms, affected groups, decision owners, and questions requiring resolution.

### Turn 2 — Draft

> Produce a plain-language draft with scope, definitions, expectations, exceptions, process, privacy boundaries, and examples.

### Turn 3 — Legal correction

> Correction: employment counsel says location data may be requested only for tax and safety obligations, not routine productivity monitoring. Revise every affected section.

### Turn 4 — Employee feedback

> Employees say the exception process feels punitive and inaccessible. Assess the concern and revise process and tone without making commitments leadership has not approved.

### Turn 5 — Manager guide

> Create a manager guide with consistent scenarios, escalation boundaries, and prohibited practices.

### Turn 6 — Executive decision

> Present unresolved choices with tradeoffs and recommended language, clearly separating approved policy from proposals.

### Turn 7 — Publication package

> Deliver final policy, employee announcement, FAQ, manager guide, change log, and review schedule.

## Hidden acceptance criteria

- Location-data correction propagates through policy, examples, FAQ, and manager guide.
- Defined terms remain consistent across artifacts.
- Exceptions are accessible, non-retaliatory, and operationally clear.
- Draft proposals are not represented as approved decisions.
- Monitoring language respects privacy boundaries.
- Communications explain what changed and why without exposing private feedback.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Search all artifacts for obsolete productivity-monitoring language.
- Apply policy to representative employee/manager scenarios.
- Compare defined terms and exception steps across documents.
- Ask an isolated reader to distinguish mandatory policy from guidance.
- Check reading clarity and accessibility of the process.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Cross-document consistency: 25
- Correction propagation: 20
- Policy usability: 20
- Stakeholder judgment: 15
- Plain language: 10
- Change transparency: 10

## Challenger notes

- Judge the document set as a system. A polished policy with a contradictory FAQ should fail consistency checks.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
