# Invalid calibration — do not use for efficacy claims

The original frozen files are preserved. Execution stopped after six finalized arms and one interrupted start because the scorer requested user JSON with the reserved `answer` field and attempted to parse `Agent.finalAnswer` after the SDK had already unwrapped it. That mechanically rejects legitimate answers and cannot measure Jev's quality.

All evidence is retained in `evidence/invalid-calibration.tar.gz`; SHA-256 `a20a4c31d1f4daffed3d4c3b087288f6656cd08b5f6f48753ea83d484e3ec7c0`.

The separately frozen [v2 diagnostic](../jev-focus-v2/PROTOCOL.md) reuses all twelve unchanged cases, corrects the scorer contract and equalizes output capacity with real Dev. It is explicitly not independent confirmation. Its complete result is [reported here](../jev-focus-v2/REPORT.md).
