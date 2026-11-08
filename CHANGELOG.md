# Changelog

## Unreleased

- Reset the active SDK surface around inspectable graph primitives and retained graph, provenance, state, and tool-safety regression coverage.
- Retain the public `Agent` API and its separate causal-memory runtime.
- Remove obsolete evaluation systems, datasets, reports, transcript comparisons, and server-backed lab surfaces from the active tree. Git history retains prior versions.
- Provide a one-task primitive CLI that always defaults to offline `MockModel`, with configured-model access only through `--live` and no implicit environment-file loading.
- Replace the lab with a manual, pure-client graph inspector without models, provider connections, backend, or scoring.
- Guard package contents against non-runtime and stale build artifacts.
- Preserve provider defaults when optional settings are undefined and keep adapter instructions neutral.
- Detect SWX by its header line so literal `SWX/1` inside JSON remains data.
- Reserve the fresh comparison for direct `GraphFrame -> GraphOps -> StateGraph` use. New inputs await the source path/example for user-selected existing product material, followed by input, grader, and budget signoffs. No model/provider change, new baseline, or result is implied.
