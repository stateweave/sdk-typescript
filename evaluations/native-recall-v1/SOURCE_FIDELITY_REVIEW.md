# Source-aware diagnostic — no rescoring

**The official frozen result remains 173/196 native, 137/196 lexical and 132/196 standard, with a failed full acceptance gate.** This review does not change any vote, replace a case, create a second endpoint, or authorize another trajectory.

After all generation and both blind judgments completed, we inspected all 16 native abstention answers, all six native-versus-lexical losses, the first fully completed native-versus-lexical win in each non-abstention stratum, and their selected original model-visible source spans. This exposed both unfavorable and favorable judgment ambiguities. It is not an independent human adjudication or an exhaustive factual audit of 588 answers.

## Concrete positive attribution

For illustration, we selected the first opaque-ID-sorted native win over lexical with all arms complete in each non-abstention stratum. This is a post-hoc mechanical example selection, not six additional independent tests. The complete ledger retains every loss and tie.

| Case / group | Difference in the answers | Native source window (UTF-16 range) |
|---|---|---|
| `c_01aaf2e344a8c844` / user fact | Native recalls **marketing specialist at a small startup**; lexical cannot find the prior occupation. | `rw_6279b5853d9854440c62`, 3600:5200 |
| `c_02ac69c3b8e3b158` / preference | Native tailors accessories to **iPhone 13 Pro**; lexical gives a generic phone list. This still uses the permissive personalization rubric. | `rw_093346f6f8806b1220ce`, 2400:4000; `rw_131cd373b7c8b36d233a`, 7200:8800 |
| `c_118146245fe0e6c0` / temporal | Native recalls starting **ukulele lessons with Rachel**; lexical finds no relevant event. Rachel appears in both questions, but only native's selected evidence windows contain her. | `rw_3274ac35d659bb6dbb1c`, 6000:7600, plus two other source windows |
| `c_13eada6e8bdbdf04` / multi-session | Native combines the **$5,000 necklace appraisal** with the vanity's $150 minimum estimate, while preserving that these are estimates, not realized proceeds. Lexical lacks the necklace value. | `rw_6a6791a03ae4cb45c138`, 9600:11200 |
| `c_1c1c0d34ca78cfe1` / assistant fact | Native retrieves the Plesiosaur's **blue scaly body**; lexical can see adjacent dinosaurs but not that description. | `rw_dc5792c373d5fa50a9d0`, 1200:2800 |
| `c_823e020b7a320b53` / update | Native uses the later Northern Flicker update, **32 species**; lexical retains the older 27. | `rw_65a44f99cfbfd1120708`, 1200:2800 |

The occupation phrase, phone model, $5,000 value and blue-body phrase occur in native's actual model-facing prompt and not lexical's. The newer bird-count statement is likewise in native's visible source window and not lexical's selected windows. These examples support a concrete source-recovery mechanism—not merely different wording—without proving that every selected detail entails an answer or that every win has the same cause.

## Two unfavorable penalties have concrete source problems

### Camera duration: a documented detail was called invented

- Case: `c_2f84c8637419837d`.
- Question: how long the user has collected **vintage films**.
- Native explicitly distinguishes films from cameras, says the records do not contain the film information, and adds that the camera collection is about three months old.
- One judge passes it. The other rejects it for an “unsupported claim” about three months. Under the frozen two-vote rule, native receives zero.
- Original source `cw_5e433b437866f2e35de00d11`, recorded May 28 before the May 30 question, says: **“I've been collecting vintage cameras for three months now.”**
- The complete statement was visible in native window `rw_c192a9492c8565e5b4fb`, UTF-16 range **6000:7600**.

The judge's specific unsupported-detail rationale is factually wrong about the supplied evidence. That does not permit changing the sealed score after seeing the result.

### Bus fare: the reference's missing-fare premise conflicts with visible evidence

- Case: `c_b41ef39cb1f0eaa2`.
- The reference says savings cannot be calculated because the bus fare was not mentioned.
- Native supplies conditional Narita/Shinjuku savings using a ¥3,200 bus fare and ¥20,000–30,000 taxi range. Both judges reject it for supplying supposedly missing fares instead of abstaining.
- Original source `cw_4f40932c865ebda546910f41`, recorded May 26 before the May 30 question, contains an assistant's prior **¥3,200 one-way Airport Limousine Bus quote**, followed by a **¥20,000–30,000 taxi quote** for the same route.
- Native visibly received this in window `rw_75ce2cf9a249ebe86a12`, range **2400:4000**. The Narita subtraction gives ¥16,800–26,800.

Those historical quoted fares were not invented by this answer. They are still assistant-provided estimates, not verified current prices or evidence of a completed purchase. This check does not certify every Haneda/currency/range claim in the answer, settle every trip-scope ambiguity, or justify marking the complete answer correct. It does show why a source-blind “missing fare” reference is not enough to diagnose the retrieval behavior.

## A favorable native label is questionable too

Case `c_e9fd988b35ee5321` asks where the user presented a poster for an **undergraduate course research project**. Native infers Harvard from two visible first-research-conference statements, then notes that no single message explicitly names the venue. Both judges pass that hedged inference as acknowledging incomplete information; lexical's more categorical Harvard answer fails.

The visible evidence does connect a thesis-research poster and a first research conference at Harvard:

- `rw_de31ad8c7bcfb5c490cd`, node `cw_7d74a68aa37986ffdbcee609`, range 0:1600.
- `rw_c525eb0f88a97eb256d9`, node `cw_62b08831d12b01ecc5867caa`, range 0:1600.

But that does not by itself establish the question's undergraduate-course qualifier. A caveat about inference should not automatically satisfy an abstention requirement. This native win therefore deserves source-aware review rather than uncritical celebration. Its frozen positive label remains unchanged too.

## Genuine overclaiming remains

- **Korea duration, `c_21b7a2c20db2d926`:** native correctly distinguishes a planned future Seoul trip from a completed visit, but then says the answer is “zero/none.” No recorded visit establishes an unknown duration, not proof of zero days. Both judges reject it. This is a real missing-evidence error.
- **Fence versus cows, `c_207850342aa61cd0`:** native leads with the fence being “first,” then admits the cow purchase and its timing are not documented. The judges split. “Only documented” does not establish the ordering of both actual tasks.
- **Coffee creamer, `c_5f86732b8792ce77`:** the reference expects Target. Lexical says it appears to be Target; native mentions the same Target context but says the store was not explicitly named. Both native votes fail. This demonstrates the endpoint's sensitivity to answering versus hedging an inferred location, not simply whether a relevant store name was retrieved.
- The remaining native-versus-lexical loss, `c_0d13024deedf9311`, is the preserved native HTTP 429 failure, not a wrong retrieved marinade duration.

The broader abstention corpus also mixes “unknown” with a reference that explicitly gives zero recorded December museum visits. Native zero-recorded-count answers can receive credit when carefully qualified. That is another reason not to interpret 12 versus 14 as a calibrated production hallucination-rate estimate.

## Interpretation

The large fixed-cohort quality gain survives both prespecified robustness checks. A separate, explicitly post-hoc exclusion of all 16 abstention cases leaves native **161/180**, lexical **123/180**, and current SDK **120/180**. Those descriptive counts do not repair the failed acceptance gate.

The right conclusion is not “the judge was wrong, therefore ship.” It is:

1. Preserve the positive answer-quality evidence and every original score.
2. Preserve the genuine unknown-versus-zero and overclaiming failures.
3. Treat source-aware abstention safety as unresolved because the model behavior and the reference-based evaluator both have weaknesses.
4. Before another confirmatory study, independently curate source-grounded negative cases and calibrate both penalties for invented facts and credit for legitimate additional evidence. Do not tune the present cases or selectively rejudge them to obtain a pass.

All original answers and both reasons remain in `CONFIRMATORY_ANSWERS.md`. No new judge call was made for this diagnostic.
