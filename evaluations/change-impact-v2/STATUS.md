# Preserved capacity-failed attempt

Frozen commit `076c36f1e9ff81f2c81cb1e08b18717d185b9bbc`. Both complete offline plumbing runs passed 512/512; they were mocks, not provider evidence.

The live four-worker runner exceeded Z.ai's concurrency limit. At explicit termination it had 145 started arms: 114 completed answers, 27 terminal failures and four unreturned/ambiguous arms. Transport evidence contains 129 HTTP-200 GLM responses, 35 HTTP-200 Jev responses, 22 HTTP-429/code-1302 rejections, and one HTTP 520. This is an operational failure, not a completed efficacy study. No accuracy or significance table was inspected before deciding the operational revision; model-answer quality was not the stopping or repetition criterion.

All recorded requests, responses, terminal results and ambiguous starts remain in `evidence/capacity-failed-attempt.tar.gz`, SHA-256 `dc2125fba095ca8d8d8c8578c131111176a4103b27f0c82411d7540d43bc7845`. Hidden thinking and credentials are excluded. No failed response is converted into a successful primary result.

V3 is a separately frozen, single complete-cohort operational repetition at two workers. It uses the identical dataset, SDK engine, Jev policy, task, budgets, arm ordering and scoring. It is NOT an untouched independent replication, and does not selectively replace failures. No further repeat is authorized by that protocol. V1's earlier parser failure remains separately preserved.
