---
id: family-logistics-022
title: Long-running family logistics coordinator
tldr: Tests whether an agent can maintain preferences, constraints, corrections, schedules, and commitments across an evolving personal planning session.
domain: long-term-knowledge-and-organization
estimated_turns: 7
status: draft
---

# Long-running family logistics coordinator

## TL;DR

The Challenger behaves like a household using one agent over time. The agent coordinates travel, appointments, school constraints, budgets, and accessibility needs while distinguishing preferences from confirmed bookings and propagating corrections.

## Private situation

The household has four people, shared and individual calendars, dietary and mobility constraints, and a fixed travel budget. No real personal data is used; all names and details are synthetic.

## Canonical request sequence

1. **Setup:** > Organize the supplied household constraints, preferences, commitments, unknowns, and decision deadlines. Do not book or claim confirmation.
2. **Trip options:** > Propose three school-break trip options that satisfy dates, budget, mobility, dietary, and travel-time constraints with explicit assumptions.
3. **Decision:** > We prefer Option B. Build a decision checklist, provisional itinerary, cost range, and items requiring confirmation.
4. **Correction:** > Correction: Sam's appointment is Tuesday, not Thursday, and cannot move. Update all affected travel and preparation plans.
5. **New constraint:** > The rail route becomes unavailable and one traveler cannot take the replacement overnight bus. Replan without discarding confirmed preferences.
6. **Coordination:** > Produce the final itinerary, preparation schedule, responsibilities, contingency contacts, and a clear list of unconfirmed items.
7. **Recall and handoff:** > Summarize the durable household preferences learned, distinguish them from trip-specific facts, and create a handoff for next time.

## Hidden acceptance criteria

- Tuesday appointment correction propagates everywhere.
- No option violates mobility/dietary constraints.
- Provisional items are never described as booked.
- Budget includes uncertainty and major omitted costs.
- Rail disruption does not erase unrelated preferences.
- Durable preferences remain separate from temporary trip facts.
- Sensitive synthetic details are not unnecessarily repeated.

## Behavioral verification

- Check every itinerary against calendar and mobility constraints.
- Recalculate costs after route changes.
- Ask surprise recall questions about durable versus temporary preferences.
- Search for stale Thursday references and confirmation overclaims.
- Give the handoff to an isolated planner.

## Quality rubric

Constraint satisfaction 30; correction propagation 20; planning usefulness 20; uncertainty/confirmation discipline 15; memory organization 10; privacy restraint 5.

## Challenger notes

This is a planning benchmark, not an authorization to make external bookings or contact real people.
