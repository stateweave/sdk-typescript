# Interpretation correction — not a scoring change

2026-09-27: the official Z.ai error table describes HTTP 429 / code `1302` as **“Rate limit reached for requests”**: https://docs.z.ai/api-reference/api-code . The four-worker attempt encountered that code, but it did not establish a particular concurrency ceiling or prove concurrency was the sole cause. The two-worker operational repetition also encountered this rejection.

The immutable v2/v3 protocols and abort records retain the agent's original, overconfident concurrency attribution. That wording is superseded by this explicit correction; neither raw evidence nor frozen scores are rewritten. The supported observation is a request-rate-limit rejection. The records do not establish the precise quota dimension, configured account cap, or competing workload. There is no evidence here of insufficient balance, and generic failures must not be assigned an unsupported provider cause.

The full repeated cohort, arm policy, thresholds, scorer, denominator and adoption bar remain unchanged. Rate-limited/failed arms remain failures under the frozen endpoint; no further repeat or selective replacement is authorized.
