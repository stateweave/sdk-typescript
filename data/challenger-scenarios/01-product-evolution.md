---
id: product-evolution-001
title: RelayDesk customer import program
tldr: Tests whether an agent can evolve one production feature across changing requirements without losing compatibility, evidence, or unfinished work.
domain: product-engineering
estimated_turns: 8
status: calibration
---

# RelayDesk customer import program

## TL;DR

The Challenger acts as a product owner over eight connected turns. Both participant agents must investigate, implement, revise, test, and release a durable CSV customer-import feature while requirements change. The same request is sent to both agents, and all work stays in one continuous session and workspace.

## Why this scenario exists

Long-running product work is rarely one clean ticket. A good agent must remember earlier constraints, preserve working behavior, respond to corrections, and distinguish completed work from promises. This scenario measures that accumulated competence rather than one-shot code generation.

## Private situation

A customer-success team needs to import up to 80,000 customer records from inconsistent CSV exports. The existing product already has customers, audit events, role-based access, and a browser UI. Imports must not duplicate records or weaken existing behavior.

The participants must not see this private situation, the hidden acceptance criteria, or the scoring rubric. They receive only the canonical requests below.

## Canonical request sequence

### Turn 1 — Investigate and plan

> We need customer CSV imports. Please inspect the current product, identify the safest smallest first release, and write a concrete implementation plan. Do not change production code yet.

### Turn 2 — Build the first release

> Implement the first useful customer-import release from the plan. Preserve existing customer and audit behavior. Add tests and verify the running product.

### Turn 3 — Interruption and resume

> A pilot upload was interrupted halfway through. Retrying must resume safely without creating duplicate customers. Add that behavior and explain the identity strategy you chose.

### Turn 4 — Correction

> Correction: email address is not a stable identity key for this customer. Their durable key is `external_customer_id`; email can change. Update the implementation and migration safely without losing prior imported records.

### Turn 5 — Error report

> Support needs a downloadable report of rejected rows with row number, original value, and a useful reason. Add it without exposing secrets or raw server paths.

### Turn 6 — Backward compatibility

> An older integration still sends `customerId` and `fullName` instead of the new column names. Support that legacy format, but document its deprecation and keep the canonical format preferred.

### Turn 7 — Operational hardening

> Prepare this for an 80,000-row import. Address bounded memory, progress visibility, cancellation, and safe retry behavior. Run realistic checks rather than claiming scalability from inspection alone.

### Turn 8 — Release review

> Review the complete import program as one release. Fix remaining mismatches, run regression and behavioral checks, and write a release note covering behavior, compatibility, migration, operations, checks, and honest limitations.

## Hidden acceptance criteria

- Existing customer, authorization, health, and audit behavior remains compatible.
- Imports persist durable job state rather than relying on browser memory.
- Retrying an interrupted job is idempotent.
- `external_customer_id` becomes the canonical identity after Turn 4.
- Email updates do not create a second customer.
- Invalid rows do not abort valid rows unless the documented policy says so.
- Error reports contain no secrets, stack traces, or host filesystem paths.
- Legacy aliases work but do not replace canonical names in new output.
- Large imports use bounded processing rather than reading the whole file into memory.
- Final claims are supported by executable or observable evidence.

## Behavioral verification

1. Import a valid mixed-status fixture and inspect persisted customers and audit events.
2. Interrupt an import, restart the application, and resume it twice.
3. Change an existing customer email while retaining `external_customer_id`.
4. Upload malformed, duplicate, legacy-schema, and mixed-schema fixtures.
5. Download the rejected-row report and inspect its content and headers.
6. Exercise cancellation and retry on a larger generated fixture.
7. Run selected pre-existing customer, authorization, and health regressions.
8. Restart the product and repeat critical reads to prove durability.

## Quality rubric

- Observable correctness: 35
- Compatibility and data safety: 20
- Long-horizon constraint retention: 15
- Verification quality: 15
- Maintainability and operational clarity: 10
- Honest limitations: 5

## Challenger notes

- Broadcast each canonical request unchanged to both participants.
- Score implementation behavior, not whether either participant copied a preferred architecture.
- A failed final response does not erase useful workspace state, but completion-gated quality for that turn is zero.
- Record task-generation and judging tokens separately from participant tokens.
