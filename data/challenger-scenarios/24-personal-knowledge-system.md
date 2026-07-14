---
id: personal-knowledge-system-024
title: Personal knowledge system over time
tldr: Tests whether an agent can organize evolving notes, decisions, corrections, and commitments without flattening everything into an unreliable summary.
domain: long-term-knowledge-and-organization
estimated_turns: 7
status: draft
---

# Personal knowledge system over time

## TL;DR

The Challenger supplies project notes, reading highlights, meeting decisions, ideas, and corrections across one session. The agent must build a useful knowledge system that preserves provenance, status, contradiction, and retrieval.

## Why this scenario exists

Long-term knowledge systems fail when summaries flatten proposals, decisions, facts, and revoked states into one narrative. This scenario directly tests provenance, contradiction handling, current-state retrieval, and whether the agent can preserve history without allowing stale information to drive action.

## Private situation

A synthetic founder is balancing product, hiring, partnerships, and personal research. Notes contain repeated names, tentative ideas, revoked decisions, and follow-ups. The system should support action and recall without pretending every note is equally true.

## Canonical request sequence

### Turn 1 — Model

> Organize the supplied notes into a minimal knowledge model for facts, sources, decisions, open questions, commitments, people, and projects. Preserve provenance.

### Turn 2 — Migration

> Import the first note set, identify duplicates and conflicts, and produce useful project and commitment views without deleting raw evidence.

### Turn 3 — Meeting update

> Add today's meeting notes. Distinguish proposed ideas from accepted decisions and assign follow-ups only where ownership is explicit.

### Turn 4 — Correction

> Correction: the Orion partnership was declined; the note saying “proceed with pilot” was an earlier proposal, not the final decision. Update every active view.

### Turn 5 — Retrieval

> Answer cross-project questions about current decisions, unresolved dependencies, and commitments, showing source and confidence.

### Turn 6 — Maintenance

> Design stale-note review, contradiction handling, archival, and lightweight capture so the system remains usable as it grows.

### Turn 7 — Handoff

> Deliver the current knowledge map, active commitments, decision changelog, unresolved conflicts, maintenance rules, and retrieval examples.

## Hidden acceptance criteria

- Orion is declined after Turn 4; “proceed” remains historical only.
- Proposals, decisions, facts, and commitments remain distinct.
- Ownership is never inferred from attendance alone.
- Raw provenance survives deduplication.
- Conflicts remain visible until resolved.
- Retrieval cites current evidence and flags uncertainty.
- Maintenance avoids destructive summarization.
- Every correction is reflected in current artifacts, while superseded statements remain historical rather than silently disappearing.
- Final claims distinguish completed actions, proposals, assumptions, and work that still lacks verification.

## Behavioral verification

- Ask entity, chronology, contradiction, and cross-project retrieval questions.
- Search active views for the revoked Orion proposal.
- Trace commitments to explicit owner evidence.
- Import duplicated and conflicting notes twice.
- Simulate stale sources and unresolved decisions.
- Give the final package to an isolated reviewer and verify that current state, owners, evidence, and next decisions are recoverable without the conversation history.

## Failure modes to watch

- Preserving an attractive initial conclusion after later evidence invalidates it.
- Producing a polished artifact that does not satisfy the observable behavior or operating constraint.
- Treating inspection, documentation, or a proposed check as evidence that work succeeded.
- Losing early constraints when later turns narrow attention to one urgent requirement.
- Repeating stale facts in summaries after the current-state artifact has changed.

## Quality rubric

- Current-state correctness: 25
- Provenance/contradiction handling: 20
- Correction propagation: 20
- Retrieval usefulness: 15
- Maintenance design: 10
- Restraint and clarity: 10

## Challenger notes

- This scenario directly pressures long-term memory representation. A concise but lossy summary should score below a traceable current-state system.
- Keep the canonical sequence fixed and broadcast each participant-facing request unchanged to both persistent agents.
- Judge anonymized outputs and artifacts by observable outcomes and rubric evidence, not by preferred implementation style.
- Do not reveal private context, hidden acceptance criteria, future corrections, or judge notes to either participant.
- Record Challenger task-driving and judging tokens separately from each participant's model, compaction, and tool usage.
