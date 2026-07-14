---
id: ai-governance-021
title: AI feature governance and release review
tldr: Tests whether an agent can govern an AI-assisted feature across intended use, evaluation, human oversight, incidents, and changing model behavior.
domain: compliance-policy-and-risk
estimated_turns: 8
status: draft
---

# AI feature governance and release review

## TL;DR

The Challenger asks agents to take an AI-assisted recommendation feature from concept through controls, evaluation, correction, pilot incident, and release decision. The work must connect policy to observable product behavior.

## Private situation

The feature summarizes support cases and recommends next actions. It may process sensitive text, can hallucinate, and could influence customer outcomes. Different teams disagree about whether it is advisory or automated.

## Canonical request sequence

1. **Intended use:** > Define intended users, decisions, prohibited uses, affected groups, data boundaries, human role, and evidence required before development.
2. **Control design:** > Create a risk/control map covering data, prompts, model/provider, output handling, access, logging, appeal, and shutdown.
3. **Evaluation:** > Design representative quality and safety evaluation with slices, failure taxonomy, baselines, thresholds, and human review.
4. **Correction:** > Correction: recommendations are automatically queued unless an agent actively rejects them; this is not purely advisory. Reassess controls, UX, and approval classification.
5. **Pilot:** > Plan a bounded pilot with consent/notice, monitoring, override, escalation, and stop criteria.
6. **Incident:** > The pilot generated a plausible but fabricated policy citation that one agent accepted. Respond, scope impact, and revise product and evaluation controls.
7. **Model update:** > The provider will change the underlying model next month. Define change assessment, regression evidence, rollback, and version traceability.
8. **Release decision:** > Deliver the final release recommendation, residual risks, evaluation results, monitoring, incident learning, ownership, and review schedule.

## Hidden acceptance criteria

- Auto-queue correction changes risk classification and human-control claims.
- Fabricated citations are detected and cannot silently trigger actions.
- Evaluation includes realistic slices and abstention/override behavior.
- Model versions and outputs are traceable without retaining unnecessary sensitive text.
- Provider updates require regression gates.
- Kill switch and rollback are behaviorally tested.
- Final claims distinguish measured performance from policy aspiration.

## Behavioral verification

- Seed fabricated and conflicting policy citations.
- Exercise accept, reject, override, appeal, and shutdown paths.
- Compare model versions on a frozen representative set.
- Test sensitive-data redaction and access controls.
- Trigger thresholds and verify escalation/rollback.

## Quality rubric

Control effectiveness 25; evaluation quality 20; correction/incident learning 20; human oversight 15; change management 10; transparency 10.

## Challenger notes

Do not reward policy documents disconnected from actual queueing and user behavior.
