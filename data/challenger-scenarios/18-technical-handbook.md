---
id: technical-handbook-018
title: Living technical handbook reconstruction
tldr: Tests whether an agent can build and maintain a coherent handbook from fragmented sources while resolving contradictions and preserving useful history.
domain: writing-and-stakeholder-communication
estimated_turns: 7
status: draft
---

# Living technical handbook reconstruction

## TL;DR

The Challenger provides scattered runbooks, READMEs, tickets, and interview notes over time. The agent must create a navigable handbook, reconcile conflicts, update it after operational changes, and retain provenance and ownership.

## Private situation

New engineers cannot tell which documents are current. Some procedures differ between regions, and one obsolete recovery command remains widely copied. The handbook must become maintainable, not merely comprehensive.

## Canonical request sequence

1. **Inventory:** > Inventory the supplied technical documentation, identify authority, duplication, contradiction, staleness, owners, and critical gaps. Do not merge blindly.
2. **Architecture:** > Propose and create a minimal handbook structure with navigation, source provenance, status labels, and contribution rules.
3. **Core content:** > Consolidate onboarding, architecture, deployment, incident, and data-recovery guidance while preserving region-specific differences.
4. **Correction:** > Correction: `restore --force-primary` is obsolete and unsafe after the storage migration. Replace it with the current recovery process and identify every reference.
5. **Operational change:** > Deployments now use progressive delivery. Update procedures, rollback guidance, examples, and ownership without erasing the former approach's historical context.
6. **Reader test:** > Test the handbook with onboarding, incident, and routine-change questions. Fix navigation and ambiguity exposed by those tasks.
7. **Governance:** > Deliver the reviewed handbook plus ownership map, freshness policy, automated checks, unresolved conflicts, and maintenance backlog.

## Hidden acceptance criteria

- Unsafe recovery command is absent from active instructions after Turn 4.
- Historical references are clearly non-executable.
- Regional differences are explicit.
- Pages expose owner, status, and last-reviewed evidence.
- Navigation supports tasks, not organizational mirroring alone.
- Progressive delivery changes rollback and deployment sections consistently.
- Unresolved conflicts remain visible.

## Behavioral verification

- Search active docs and snippets for unsafe commands.
- Give isolated readers realistic tasks and measure successful navigation.
- Validate internal links and referenced files.
- Compare deployment and rollback terminology across pages.
- Simulate an overdue review and owner departure.

## Quality rubric

Safety/correctness 25; cross-document consistency 20; task usability 20; correction propagation 15; governance 10; provenance 10.

## Challenger notes

Volume is not quality. Penalize duplicated pages and active instructions without authority or ownership.
