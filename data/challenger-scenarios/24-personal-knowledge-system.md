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

## Private situation

A synthetic founder is balancing product, hiring, partnerships, and personal research. Notes contain repeated names, tentative ideas, revoked decisions, and follow-ups. The system should support action and recall without pretending every note is equally true.

## Canonical request sequence

1. **Model:** > Organize the supplied notes into a minimal knowledge model for facts, sources, decisions, open questions, commitments, people, and projects. Preserve provenance.
2. **Migration:** > Import the first note set, identify duplicates and conflicts, and produce useful project and commitment views without deleting raw evidence.
3. **Meeting update:** > Add today's meeting notes. Distinguish proposed ideas from accepted decisions and assign follow-ups only where ownership is explicit.
4. **Correction:** > Correction: the Orion partnership was declined; the note saying “proceed with pilot” was an earlier proposal, not the final decision. Update every active view.
5. **Retrieval:** > Answer cross-project questions about current decisions, unresolved dependencies, and commitments, showing source and confidence.
6. **Maintenance:** > Design stale-note review, contradiction handling, archival, and lightweight capture so the system remains usable as it grows.
7. **Handoff:** > Deliver the current knowledge map, active commitments, decision changelog, unresolved conflicts, maintenance rules, and retrieval examples.

## Hidden acceptance criteria

- Orion is declined after Turn 4; “proceed” remains historical only.
- Proposals, decisions, facts, and commitments remain distinct.
- Ownership is never inferred from attendance alone.
- Raw provenance survives deduplication.
- Conflicts remain visible until resolved.
- Retrieval cites current evidence and flags uncertainty.
- Maintenance avoids destructive summarization.

## Behavioral verification

- Ask entity, chronology, contradiction, and cross-project retrieval questions.
- Search active views for the revoked Orion proposal.
- Trace commitments to explicit owner evidence.
- Import duplicated and conflicting notes twice.
- Simulate stale sources and unresolved decisions.

## Quality rubric

Current-state correctness 25; provenance/contradiction handling 20; correction propagation 20; retrieval usefulness 15; maintenance design 10; restraint and clarity 10.

## Challenger notes

This scenario directly pressures long-term memory representation. A concise but lossy summary should score below a traceable current-state system.
