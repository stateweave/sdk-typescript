# Compound-node hard A/B preregistration

## Frozen identity

- Protocol: `compound-node-hard-ab-v3`
- Model: `glm-5.3`
- Cases: 22 new independent paired cases
- Fixture SHA-256: `43db70d7647f56298dc71a18c64a4bfa00ca5ee0673cc771463804fc8add9092`
- Arms: current `CAUSAL_WEAVE/1` flat projection and `COMPOUND_WEAVE/1`
- Execution order: alternating flat-first and compound-first by case index

This document and the fixture are committed before the first model answer. The prior ten-case GLM 5.2 and GLM 5.3 pilots informed difficulty design but are excluded from this analysis.

## Hypothesis

Explicit compounds that participate as outer nodes, expand into internal atoms, and connect through typed ports improve exact answer-and-evidence performance over the current flat projection under difficult cross-boundary reasoning.

## Controls

Both arms receive the same provider, model, temperature zero, 1,024-token output ceiling, evidence atoms, causal links, question, output contract, and bounded 10/30/60-second retry policy for transient 429/529 failures. Gold answers and scoring metadata remain server-side. The compound arm alone receives explicit compound membership because that is the tested capability.

## Primary endpoint

A case is a full pass only when:

1. the answer contains every preregistered semantic answer token and none of its excluded answer tokens;
2. every preregistered required evidence key is cited;
3. no preregistered forbidden stale or lower-authority evidence key is cited.

A paired winner is the only full-pass arm. If both or neither full-pass, answer correctness breaks the tie. Cases still tied after answer correctness do not enter the sign test.

The primary statistic is the exact two-sided paired sign test over non-tied winners at alpha 0.05. The result is reported once regardless of significance. No cases may be added, removed, replaced, or edited after the first model call. A significant result supports a larger independent replication; it does not by itself authorize product promotion.

## Secondary endpoints

Answer accuracy, evidence completeness, forbidden-evidence cleanliness, prompt tokens, provider usage, latency, and provider attempts are descriptive. They do not replace the primary endpoint.

## Failure handling

Transient provider overload receives the same bounded retry policy in both arms. If infrastructure or provider failure exhausts retries and prevents a complete run, the incomplete run is preserved and excluded as operational failure; the exact unchanged fixture may restart from zero after recovery, with the exclusion disclosed. Model failures and valid model outputs are never rerun for a better score.

## Frozen case families

1. Four-stage yield with rework and reserve
2. Constrained vendor ranking with exclusions
3. Only feasible day across four calendars
4. Delegated authority after expiry and revocation
5. Invoice with scoped discount and tax
6. Parallel dependency critical path
7. Inventory after allocations, return, damage, and reserve
8. Signed configuration over stale and claimed values
9. Unique candidate from four-way set intersection
10. Supermajority defeated by an active veto
11. Energy total with overhead and offset
12. Retention under hold, regulation, and false incident claim
13. Overlapping assets without double counting
14. Capacity ceiling with cancellations and mandatory spare
15. Eligibility first, then score and latency tie-break
16. Balance with reversed stale debit
17. Shortest feasible route under closure and capacity
18. Tiered sampling with certified reduction
19. Bill of materials with partial substitution and rebate
20. Tournament winner after active penalty and stale appeal
21. Capacity after nested reservations and shared backup
22. Service-level result from weighted current windows
