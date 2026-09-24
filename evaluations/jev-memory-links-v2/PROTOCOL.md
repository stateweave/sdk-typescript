# Fresh-case validation after explicitly unsuccessful v1 calibration

V1 remains frozen: its .97 equivalence/.03 incompatibility gate recognized only 1/12 equivalents, versus 2/12 for normalized exact matching. Graph coverage did not improve. This failure is preserved; it is not retroactively rescored as a success. Raw v1 scores showed equivalent cases at .84–.99, non-equivalents no higher than .43, and incompatible judgments of .02–.07 on equivalent cases. This motivates a DIFFERENT POLICY, not a changed v1 result.

Freeze this v2 protocol, all fixtures and code in Git before fresh provider calls. Run exactly once. No subsequent tuning, extra cases, optional stopping or efficacy p-values. This is a small author-designed out-of-calibration feasibility set, not blinded external confirmation or a natural-history evaluation. The author knows v1 results. Existing focus pilots and frozen application benchmarks remain untouched.

## Frozen new policy

Use unchanged v1 source-text questions, pinned Jev 1.13.0 and batches of <=6 pairs, mixed using SHA-256 ordering with salt `links-v2`. Send left/right source texts only; never gold labels. Preserve original raw judgments and separately label the v2 policy result.

Exact NFKC/case/whitespace matching is the first-line deterministic comparator and part of the combined arm. Admit an additional equivalent link only when equivalence >= .90 AND incompatibility <= .10. Keep conflict flagging at >= .97 incompatibility AND <= .03 equivalence. Otherwise abstain. These are empirically chosen thresholds, not guarantees. Benchmark all pairs for a complete error ledger even when exact matching would permit skipping the network in a future implementation.

The 32 fresh cases contain 16 equivalents and 16 non-equivalents (3 incompatible, 13 otherwise distinct/overlapping/ambiguous). Controls include necessary versus sufficient conditions, same first name without identity proof, exclusive permissions, additional information, temporal/environment differences, negation, units, uncertainty and quantifiers. Do not merge nodes or overwrite conflicting statements. Source assertions are synthetic.

## End-to-end pressure fixtures

Create Lumen's first eight pairs, Harbor's next eight, and both together. Context node ceilings are 10, 10 and 16; other SDK budgets and the prototype are unchanged. Within each fixture, all arms share exact content/IDs/parents/order/timestamps. Arms: current deterministic SDK, normalized exact dedup, normalized exact plus Jev dedup. Retain authoritative source graphs unchanged; aliases affect optional projection only and bind immutable source IDs. Source/version/turn safeguards remain unchanged from v1.

Primary endpoint is unique factual families present in the final model-call read set under the same node cap. Either equivalent member counts. This is a GRAPH COVERAGE endpoint, not an answer-accuracy score. The three fixtures share source pairs and are dependent. No generalization or p-value claim is permitted.

Run nine real Agent calls using Dev GLM 5.3 Flash, temperature 0, 4096 output ceiling, maxIterations 2, no tools, identical task and system prompts, Latin-rotated arm order. Preserve answers, traces, provider usage and latency for qualitative review. Build the Jev index once; graph queries perform no new Jev calls. Report all index-building cost separately. Do not deploy the prototype or change the running app. No automatic retries; ambiguous/incomplete requests remain recorded and stop the probe.

## Safety and decision

Any false equivalent blocks a recommendation for automatic suppression, regardless of coverage improvement. Require higher coverage than both controls and zero observed false equivalents even to call the prototype promising. Thirty-two designed cases cannot establish a sufficiently low real-world false-merge rate. Candidate-pair discovery, realistic histories, changing authority, automatic ingestion, cache persistence at the application boundary and production latency remain unvalidated. A successful result justifies further independent evaluation and an opt-in implementation proposal, never default activation.
