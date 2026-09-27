# Optional change-impact review (experimental)

This branch adds one optional semantic judgment stage to the existing public Agent. It does not add an agent class, replace the causal engine, or enable Jev by default.

```ts
import { Agent, createJevChangeReviewer } from "stateweave";

const agent = new Agent({
  model,
  state,
  tools: [],
  enforceCompletionEvidence: false,
  changeReviewer: createJevChangeReviewer({ apiKey: process.env.TYPESAFE_API_KEY! })
});
const result = await agent.run(question, {
  changedNodeIds: [incomingResourceId],
  reviewDependencies: [
    { premiseId: originalClaimId, dependentId: researchNoteId },
    { premiseId: researchNoteId, dependentId: reportId }
  ]
});
```

Only current explicitly supplied resource/tool-result/goal nodes are eligible changes. A deterministic lexical pass nominates at most 64 current non-artifact semantic nodes. The opt-in adapter sends bounded source text and candidates to TypeSafe and returns one contradiction probability per candidate. At probability ≥0.80, at most five originals receive context preference together with one runtime-owned advisory verification node. The existing compiler retains authority over node/token limits; diagnostics expose actual inclusion, not just nominations. Review advice and nominated originals take priority, with unused preference slots retaining earlier caller/focus choices, up to six total. Focus and review diagnostics attribute selected nodes only to their own nominations. Provenance IDs alone do not guarantee that source text reached the model: inspect the compiled context. The evaluation supplies the complete new evidence equally in every task and verifies its inclusion.

Jev is not the source of truth. Suggestions can be false, and no original is deleted, rewritten or automatically corrected. The advisory's parents identify every source/candidate supplied to the judge; ordinary actions still record the exact compiled read set. Explicit caller-supplied dependency edges must be existing direct causal edges; traversal follows only that subset, not every read-set ancestor. Dependent outputs need review, not automatic invalidation. Traversal may pass through an explicitly approved historical intermediate to a current descendant; superseded outputs themselves are omitted. A newer replacement is never inferred to depend on the old version without its own declared edge. Exact IDs prevent silent rebinding.

Review annotations use a source-identity-group key. Each explicit review expires that group's prior advice before requesting a fresh judgment, even when only candidates, dependency approvals or the reviewer changed. No judgment cache is silently reused after a failed refresh. Empty new reviews are not a graph-wide clearance. Review failures add no claim nominations and preserve the preceding preferences; cancellation propagates. Successful-run-only commit and reset-generation fencing are unchanged, so aborted/failed turns never commit even expiry annotations. This is scoped turn-entry handling, not a global watcher: consumers own consistent source-group identity and must not treat historical exported annotations as independently current. Changing source-group membership creates a different namespace; overlapping groups are not automatically invalidated. Keep a stable logical evidence bundle or handle cross-group validity outside this prototype.

`prepareChangeReview` exposes the same bounded candidate preparation for callers. `propagateReview` applies declared dependency links independently of Jev. `preferredNodeIds` is an optional run input bounded to six existing IDs, allowing an honest deterministic comparison and caller-owned selection; preference is not a guarantee of inclusion.

Metadata and context progress expose `changeReview` with source/candidate/flagged/dependent/selected IDs, provider usage/model, latency, annotation ID and fallback status. Credentials remain server-side. Sending private state to a third party requires the consumer's explicit opt-in and access policy before invoking this adapter.

Limits: source ≤12,000 characters, at most four sources totaling ≤24,000; candidate ≤1,200 characters; 64 candidates; five nominations; 15-second default provider timeout. Long candidate records are omitted rather than silently truncated. The lexical shortlist is currently ASCII-oriented; multilingual or alias-only recall is not established, and omitted candidates cannot be recovered by Jev. No automatic background scheduler, tool-step observer, discovered dependency approval, cross-tenant index, or complete historical-version review is provided. Caller-declared change inputs and edges must be persisted by the consumer. The fixed threshold is experimental, not a calibrated guarantee.

The source-linked SciFact stress protocol and exact adoption bar are in `evaluations/change-impact-v3/PROTOCOL.md`; earlier failed attempts remain preserved. The frozen trial uses its original runtime, not subsequent lifecycle/composition hardening. No production or default promotion follows automatically from the result.
