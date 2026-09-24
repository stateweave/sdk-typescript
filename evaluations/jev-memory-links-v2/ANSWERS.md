# Complete unedited main-model final answers

## graph-0-deterministic.json

Based on the recorded facts, the Lumen release constraints are:

1. **Data residency:** Lumen release traffic must remain in Canada (recorded twice, with the duplicate phrased as "traffic ... required to stay in Canada").
2. **Privacy/logging:** The Lumen release must not log customer email addresses.
3. **Schema:** The Lumen release uses schema version 8 (recorded twice).
4. **Testing:** The Lumen release test timeout is 240 seconds (recorded twice, once in all caps).

Additionally, one recorded release fact is a schedule rather than a constraint: the Lumen release deployment is scheduled for 2031-06-12.

Note: The duplicate records above (Canada traffic, schema version, and test timeout each appear twice) have been consolidated into single constraints; no other release constraints are recorded.

## graph-0-exact.json

The recorded Lumen release constraints are:

1. **Log retention** — release logs are kept for 45 days (recorded twice, in equivalent wording).
2. **Data residency** — release traffic must remain in Canada (recorded twice, in equivalent wording).
3. **Privacy** — the release must not log customer email addresses.
4. **Testing** — test timeout is 240 seconds.
5. **Schema** — the release uses schema version 8.

Note: the deployment being scheduled for 2031-06-12 is also recorded, but it is a schedule rather than a constraint. Duplicate statements have been merged, and no other constraints are recorded in the supplied facts.

## graph-0-jev.json

Based on the recorded facts available in the current view, the Lumen release constraints are:

1. **Approval**: Priya must approve the Lumen release.
2. **Maintenance window**: The release maintenance duration is 120 minutes.
3. **Log retention**: Lumen release logs are kept for 45 days.
4. **Data residency**: Traffic for the Lumen release must stay in Canada.
5. **Privacy**: Logging customer email addresses is forbidden for the Lumen release.
6. **Testing**: The Lumen release test timeout is 240 seconds.
7. **Schema**: The Lumen release uses schema version 8.
8. **Schedule**: June 12, 2031 is the scheduled deployment date.

Note: The underlying memory record contains 17 nodes, but only these 8 are exposed in the current view. Any additional recorded constraints beyond these are unknown from the available information.

## graph-1-deterministic.json

The recorded Harbor release constraints are:

1. **Review requirement** — A Harbor release requires at least three reviewers.
2. **Latency rollback** — The release must roll back if response latency exceeds 700 milliseconds (0.7 seconds). (Recorded twice with equivalent wording.)
3. **Invoice payment deadline** — Harbor release invoices must be paid within 21 days (three weeks after invoicing). (Recorded twice with equivalent wording.)
4. **Backup schedule** — Harbor release backups run every Monday at 04:30 UTC. (Recorded twice with equivalent wording.)

Additionally, the record notes that Harbor release audit artifacts are stored in Zurich — a recorded fact about artifact location rather than a release condition. No other release constraints are recorded in the available information.

## graph-1-exact.json

Based on the recorded facts, the Harbor release constraints are:

1. **Reviewer requirement** — the Harbor release requires at least three reviewers.
2. **Latency rollback** — if response latency exceeds 700 milliseconds (0.7 seconds), the Harbor release must roll back. (Recorded twice with equivalent phrasing.)
3. **Invoice payment deadline** — Harbor release invoices must be paid within 21 days (i.e., three weeks after invoicing). (Recorded twice with equivalent phrasing.)

Additional recorded Harbor release facts that are stated as operations rather than constraints: audit artifacts are stored in Zurich, and backups run every Monday at 04:30 UTC (also recorded twice with equivalent phrasing). No other release constraints are recorded.

## graph-1-jev.json

Based on the recorded facts, the Harbor release constraints are:

1. Support is provided on weekdays only.
2. The maximum permitted budget is 3,200 euros.
3. No fewer than 3 reviewers are required.
4. The release must roll back when response latency exceeds 0.7 seconds.
5. Invoices must be paid within three weeks of invoicing.

Additional recorded facts about the release (context rather than constraints): Sofia owns the Harbor release, audit artifacts are stored in Zurich, and backups run every Monday at 04:30 UTC. No other constraints are recorded in the supplied facts.

## graph-2-deterministic.json

Based on the recorded release facts, the following constraints are on file:

Lumen release constraints:
1. Test timeout is 240 seconds.

Harbor release constraints:
1. Support is provided on weekdays only.
2. Release owner is Sofia.
3. Budget cannot exceed EUR 3200.
4. Audit artifacts must be stored in Zurich.
5. At least three reviewers are required.
6. The release must roll back if response latency exceeds 700 milliseconds (0.7 seconds).
7. Invoices must be paid within 21 days (three weeks) of invoicing.
8. Backups run every Monday at 04:30 UTC.

Note: Several recorded facts were duplicated with equivalent wording (budget limit, Zurich storage, latency rollback, invoice deadline, backup schedule); these have been consolidated above. No Lumen constraints beyond the 240-second test timeout are recorded in the supplied facts.

## graph-2-exact.json

Using only the recorded facts (duplicate phrasings consolidated):

**Lumen release constraints**
- Release test timeout is 240 seconds.

**Harbor release constraints**
- Support is provided on weekdays only.
- Release owner is Sofia (recorded fact).
- Budget cannot exceed EUR 3,200.
- Audit artifacts are stored in Zurich.
- At least three reviewers are required.
- The release rolls back if response latency exceeds 700 milliseconds (0.7 seconds).
- Invoices must be paid within 21 days (three weeks after invoicing).
- Backups run every Monday at 04:30 UTC.

No other Lumen or Harbor release constraints are recorded in the available facts.

## graph-2-jev.json

Based on the recorded facts, here are all the Lumen and Harbor release constraints:

**Lumen release:**
- Traffic for the release is required to stay in Canada.
- The scheduled deployment date is June 12, 2031.
- Logging customer email addresses is forbidden.
- The release uses schema version 8.
- The test timeout is 240 seconds.

**Harbor release:**
- Support is provided on weekdays only (Monday through Friday).
- Sofia owns the release.
- The maximum permitted budget is 3200 euros.
- Audit artifacts are stored in Zurich.
- No fewer than 3 reviewers are required.
- The release must roll back when response latency exceeds 0.7 seconds.
- The payment deadline for invoices is three weeks after invoicing.
- Backups run every Monday at 04:30 UTC.

These are all the recorded Lumen and Harbor release facts in the current context; no additional constraints are recorded.
