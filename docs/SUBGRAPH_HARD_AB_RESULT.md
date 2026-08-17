# Compound-node hard A/B result

## Frozen run

- Protocol: `compound-node-hard-ab-v3`
- Model: `glm-5.3`
- Fixture SHA-256: `43db70d7647f56298dc71a18c64a4bfa00ca5ee0673cc771463804fc8add9092`
- Started: `2026-08-17T03:21:39.406Z`
- Completed: `2026-08-17T03:29:27.448Z`
- Preregistration: [`SUBGRAPH_HARD_AB_PREREGISTRATION.md`](./SUBGRAPH_HARD_AB_PREREGISTRATION.md)

The fixture and decision rule were merged and deployed before the first model answer. Prior pilot cases are excluded.

## Primary result

| Metric | Flat | Compound |
|---|---:|---:|
| Answer correct | 21/22 | 21/22 |
| Full pass | 15/22 | 16/22 |
| Non-tied wins | 2 | 3 |
| Mean estimated prompt tokens | 4,911 | 763 |
| Median latency | 4.65 s | 6.79 s |
| Provider attempts | 22 | 24 |

There were 16 both-arm ties and one neither-arm tie. The exact two-sided paired sign test over the five non-tied winners is `p = 1.0000`. The preregistered alpha was 0.05. The result is not significant.

## Case ledger

| # | Case | Flat | Compound | Winner |
|---:|---|---|---|---|
| 1 | Four-stage yield with rework and reserve | Full | Full | Both |
| 2 | Constrained vendor ranking with exclusions | Answer only | Answer only | Both |
| 3 | Only feasible day across four calendars | Full | Full | Both |
| 4 | Delegated authority after expiry and revocation | Answer only | Full | Compound |
| 5 | Invoice with scoped discount and tax | Full | Full | Both |
| 6 | Parallel dependency critical path | Full | Full | Both |
| 7 | Inventory after allocations, return, damage, and reserve | Full | Full | Both |
| 8 | Signed configuration over stale and claimed values | Full | Full | Both |
| 9 | Unique candidate from four-way set intersection | Answer only | Answer only | Both |
| 10 | Supermajority defeated by an active veto | Scored fail | Scored fail | Neither |
| 11 | Energy total with overhead and offset | Full | Full | Both |
| 12 | Retention under hold, regulation, and false incident claim | Answer only | Full | Compound |
| 13 | Overlapping assets without double counting | Full | Full | Both |
| 14 | Capacity ceiling with cancellations and mandatory spare | Full | Full | Both |
| 15 | Eligibility first, then score and latency tie-break | Full | Forbidden claim cited | Flat |
| 16 | Balance with reversed stale debit | Full | Answer only | Flat |
| 17 | Shortest feasible route under closure and capacity | Answer only | Answer only | Both |
| 18 | Tiered sampling with certified reduction | Full | Full | Both |
| 19 | Bill of materials with partial substitution and rebate | Full | Full | Both |
| 20 | Tournament winner after active penalty and stale appeal | Answer only | Full | Compound |
| 21 | Capacity after nested reservations and shared backup | Full | Full | Both |
| 22 | Service-level result from weighted current windows | Full | Full | Both |

## Non-tied differences

- Case 4 favored compound because flat omitted Alice's revocation, Bob's expired clearance, and Dana's lack of direct authority from its evidence list.
- Case 12 favored compound because flat omitted the conditional incident-extension rule.
- Case 15 favored flat because compound cited the forbidden lower-authority claim about applicant D.
- Case 16 favored flat because compound cited the reversal but omitted the original erroneous debit.
- Case 20 favored compound because flat omitted the conditional head-to-head tie-break evidence.

## Scoring sensitivity

Both case-10 answers were semantically correct, but the frozen token scorer required `veto` while both answers used `vetoes`. Both also omitted preregistered quorum evidence, so treating the morphology as correct leaves the case tied and does not change the 3-2 primary result or p-value.

## Interpretation

The compound representation reduced estimated prompt size by 84.5 percent without changing answer accuracy, but it did not produce a statistically detectable quality advantage. Typical compound latency was slower, and two compound calls needed transient-overload retries. The evidence supports compound representation as a context-compression candidate, not as a demonstrated reasoning-quality improvement.

At the observed three-to-two split, extending or replacing cases until significance would be optional stopping. Any future study must use a new independent frozen corpus and a prospective power or alpha-spending plan.
