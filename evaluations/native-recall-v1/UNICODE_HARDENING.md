# Post-run Unicode transport hardening

This is an engineering correction, **not a replacement confirmation run**. The measured implementation remains `2cba138f4afec03f83a1269622a089e2005cb5b6`, with freeze commit `a1a3e33591c57a44c549422974c5cbee89a228ba`. The original 196-case evidence, failures, judgments, scoring rules, and acceptance gate are unchanged. Nothing here authorizes merge or deployment.

The correction was prepared after generation finished, while the frozen blind judging continued, without consulting interim quality scores.

## Observed defect

Case `c_c3f4f5b45606d98f` contained a valid astral character across UTF-16 offsets 1599–1600. The frozen source-window builder copied `text.slice(0, 1600)`, leaving an unpaired high surrogate. Its range and window hash passed the original UTF-16 validator, but it was not a valid Unicode-scalar string for the providers.

- Lexical main request `main-436`: HTTP 500, explicitly reporting that UTF-8 encoding rejected `\ud83c`.
- Native Jev request `jev-146`: HTTP 400, with the same malformed request string.
- Native fallback main request `main-437`: HTTP 500 with the same encoding failure.

These are **candidate clipping defects**, not unrelated provider outages. Both main arms remain failed in the original analysis. Their original graph sources were not modified, and neither produced an accepted answer. The frozen source audit proves the checks it actually implements; it does not establish Unicode-scalar boundary safety.

## Correction

The separate hardening worktree changes only text-boundary handling and validation:

- A window starting inside a surrogate pair advances by one UTF-16 unit; a window ending inside a pair retreats by one. The original 1,200-unit stride and 1,600-unit ceiling remain.
- Source prefixes and capped recall queries retain whole scalar values without replacement characters or normalization. Offsets still refer to the original UTF-16 source.
- Projection validation rejects half-pair ranges even when their copied substring and hash match.
- Malformed original recall text fails clearly without silently rewriting or dropping it. The Jev client rejects malformed strings before transport.
- Current-task, payload, and inline-timeline clipping in the causal compiler uses the same safe prefix boundary and reports the actual omitted UTF-16 units.

This is scalar-boundary safety, not grapheme-cluster segmentation or a claim to have audited every legacy/UI text path. There is no budget increase, new ranking policy, source mutation, provider retry, or score repair.

## Verification

Ten focused tests cover prefix/end/start boundaries, exact copying and IDs, forged ranges, invalid original text, failed-turn state preservation, pre-transport rejection, capped queries, causal/molecular compiler clipping, and complete mocked Agent turns. TypeScript checks cover both SDK and web; the package build and 139-file package verification pass. The full SDK suite passes 293 tests; all 21 evaluator tests and the importer/exclusive-receipt checks also pass.

`replay-unicode.mjs` checks the sealed participant hashes and both runtime identities, denies network access, and restores recorded timestamps only to reproduce clock-sensitive hierarchy labels. It refuses to feed recorded model output to a changed input.

The offline check covers all **196 source indices**:

- Exactly **one** candidate index changes: the encoding-failure case above.
- All **386 successful lexical/native paths** reproduce their original prompts, traces, states, and answers exactly in both the frozen and hardened runtimes.
- The **six failed lexical/native paths are not replayed as successes** and receive no replacement score. The standard arm is outside this differential replay.
- Two separately marked simulated checks take the actual encoding-failure fixture through the repaired lexical/native Agent paths. They verify well-formed request strings and unchanged original source nodes, return only `OFFLINE UNICODE TRANSPORT CHECK ONLY`, and make **zero provider calls**.

The simulation establishes local transport construction, not acceptance by a live provider or answer correctness. The preserved successful-path parity is not new efficacy evidence, nor a general lifecycle guarantee.

## Reproduction

Use the original measured `dist` for the frozen argument and this branch's built `dist` for the candidate. Do not rebuild or overwrite the measured runtime.

```sh
node evaluations/native-recall-v1/replay-unicode.mjs \
  <original-generation-evidence> <sealed-holdout-directory> \
  <frozen-2cba138-dist> <hardened-dist>
```

Generation/judging must never be rerun to replace the original failed arms. The one-shot receipt remains authoritative.
