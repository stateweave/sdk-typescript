# Primitive comparison

This is the home for a fresh, outcome-based comparison. No input set, grader,
model run, baseline score, or hillclimb result has been approved or produced.

## What is being compared

- **StateWeave:** the existing `GraphFrame -> GraphOps -> StateGraph` path,
  using `src/agent/stateweaveRunner.ts` and the real core parser, validator,
  immutable operation application, and scoped tool execution.
- **Control:** an ordinary, persistent Messages conversation. It retains the
  actual user/assistant/tool history; it must not guess tools from keywords,
  inject answers, discard unsuccessful actions, or use the public `Agent` as a
  surrogate.

The public causal `Agent` is a separate SDK interface, not this experiment's
StateWeave arm. Protocol/state representation differences are intrinsic to this
comparison; results must not be described as an isolated representation-only
ablation unless the eventual design actually establishes that.

## Input source

The user selected **the current StateWeave SDK code/docs** as the source for
fresh product-derived task proposals, not Vero, X Console, or deleted evaluation
cases. Use the SDK source reviewed on this cleanup branch; the canonical checkout
still contains obsolete material until the cleanup is merged. The selected flow
is multi-turn JSON/SVG workspace editing grounded in retained SDK tool/runner
regressions, graded on actual final workspace effects and any requested answers.
Record exact source paths and revision, permissions, retention constraints, and
expected-output provenance.
Documentation/regression-derived proposals are not production traffic. The user
explicitly approved the five synthetic seeds in `workspace-editing-v1/cases.json`
after reviewing their complete initial files and twenty turns. That input sign-off
does not approve an expanded cohort.

The deterministic actual-output grader in `workspace-editing-v1/` was approved
for the five seeds on 2026-11-08. Its provider-neutral runner core now exercises
the real primitive path and an eval-only persistent Messages control under
offline scripted tests. No provider adapter or live execution is approved, so do
not claim a baseline or capability result.

## Construction requirements

- Exercise the real primitive entry point, not a reconstruction of its prompt.
- Match provider/model, task evidence, tool capabilities, environment, and
  agreed resource ceilings. Record any remaining asymmetry explicitly.
- Grade actual answers or final workspace effects. Keep Boolean outcomes
  separate from completion, format, serving errors, and operational failures.
- Give each arm a fresh, isolated fixture. Neither arm may access gold, future
  turns, the opposite arm, host files, credentials, shell, or external network.
- Record served model, stop reason, provider usage including cache tokens,
  individual requests/tool calls, provider latency, and total wall time.
  Missing usage and unknown prices remain unknown, never measured zero.
- Test the entire runner/grader on reference, empty, constant, plausible-wrong,
  legitimate-negative, no-op, malformed, timeout, and serving-error controls.
- Keep per-case transcripts and grades from the same calls. Preserve literal
  task/artifact bytes while excluding private provider reasoning and credentials.
- Freeze cases, graders, runtime/configuration, split, retry semantics, and
  comparison endpoints before paid execution. Do not silently repair outputs.

## Build-eval, then hillclimb

Follow Anthropic's `claude-api` build-eval, eval-audit, and eval-hillclimb guides,
reviewed at upstream commit `2c5958ecac7cee2b583967a2c4981d0f4a75c579`:

https://github.com/anthropics/skills/tree/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/claude-api/shared/evals

Use the upstream runner scaffold and report contract where appropriate, adapting
only the real primitive/control entry points and approved grading. Do not add an
AI-engineering framework. Methodology does not select a provider or grant spending.

After an audited baseline exists, agree the optimization target, editable paths,
off-limits files, repetitions, split, noise floor, stopping rule, and a bounded
paid-run plan. Keep the Messages control fixed while tuning only approved
StateWeave levers. An analyzer sees training evidence only; validation may select
a candidate, with a final held-out comparison reserved for baseline versus that
candidate. Report dependent case families and the resolution the sample supports.

No provider call, credential handoff, automatic retry/resume, or unattended
hillclimb is authorized by this document. Earlier approvals are not reusable.
