# One-shot SDK OpenShell benchmark

This is a separate dev-only paired artifact benchmark. It does not share state, workspaces, protocol, or controls with Infinite Agent v8.

Two fresh OpenShell sandboxes receive byte-identical payloads and the same fixed participant prompt. One sandbox runs the graph-memory agent and one runs the transcript-memory agent. Execution and blind A/B labels are independently randomized. The model, provider system, file tools, full sandbox shell tool, 300-step cap, 250k context ceiling, CPU, memory, dependency payload, and starting files are otherwise matched.

After an unscored completed A/B run, the operator may explicitly launch a separate **Variant C** workspace at the fixed 3,000-step exploratory ceiling. A reviewed Variant C runtime correction may receive an operator-only fresh retry while preserving every prior C artifact. Variant C uses the same prompt, provider system, model, tool objects, executor, sandbox policy, dependencies, seed workspace, and 250k hard provider-input ceiling. Its only new primitive is Causal Weave: immutable content-addressed causal nodes, an active frontier, and a bounded graph compiler; model output remains the same ordinary `TOOL_CALL`/`FINAL` protocol as the transcript agent. The v3 compiler targets a 16k working projection under that unchanged hard ceiling, using a deterministic whole-graph digest and supersession of repeated detailed evidence. Variant C never overwrites A/B artifacts or participates in their blind labels.

The public lab can write only fixed start/stop markers under the existing named `/data` volume. A root host worker consumes those markers and manages OpenShell through its local mTLS gateway. No OpenShell credentials, Docker socket, host path, provider credential, or arbitrary task reaches the web container.

## Security

- OpenShell `v0.0.52` remains pinned alpha software.
- Every participant is UID 998 with hard-required Landlock.
- Only `/sandbox` and `/tmp` are writable.
- Ordinary network is default-deny; inference uses managed `inference.local`.
- A security probe must pass independently in both sandboxes before either participant starts.
- The full `bash_command` tool executes inside the sandbox, never on the host or web container. It uses a dedicated process group and terminates every descendant on completion, timeout, or abort so npm/Vitest workers cannot leak across calls.
- `write_file`/`edit_file` provide canonical mutation evidence. Because both candidates also receive a genuinely full shell, each shell call snapshots meaningful workspace files before/after and reports bounded `mutated_paths`; shell-created source/config/docs therefore count as real mutation evidence and reset the no-progress watchdog, while caches, build output, probe temporaries, logs, PIDs, and test-report files do not. Hard-Landlock `/dev/null` references are redirected to a fresh private `/tmp/.stateweave-null` file for each shell call.
- Tool-call nodes preserve bounded arguments, and the graph projection renders a dedicated 32,000-character latest-tool-evidence window so file reads and shell failures remain actionable instead of collapsing to a 1,200-character nested preview. SWX parsing also preserves shell-significant quotes in unwrapped commands such as `node -e "..."`.
- Graph attempts stop after 300 consecutive model iterations without a successful workspace mutation, checkpoint frame and live provider token totals every 50 iterations, and serialize bounded per-step tool/error diagnostics plus frame/trace metrics on catchable failures.
- The downloaded candidate workspace excludes the preinstalled dependency symlink.
- The source prompt contains no treatment, comparison, score, or reference identity.

## Payload preparation on Eve

Build from an exact reviewed commit. Supply the existing browser-only Desmos API key through a transient shell variable; the key is used only to download the browser bundle and is neither committed nor copied into the payload.

```shell
cd /root/stateweave-sdk-benchmark/source
DESMOS_API_KEY="$key" ./ops/openshell-benchmark/prepare-payload.sh
unset key DESMOS_API_KEY
install -m 0644 ops/openshell-benchmark/stateweave-sdk-benchmark.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now stateweave-sdk-benchmark.service
```

The worker uses:

- payload: `/root/stateweave-sdk-benchmark/payload`
- shared control/state: `/var/lib/docker/volumes/stateweave-web-development-zrzoej_stateweave-web-data/_data/sdk-build-benchmark`
- service: `stateweave-sdk-benchmark.service`

The public endpoint can retry only a failed, unscored candidate. After a reviewed runtime correction, an operator may rerun a completed candidate without touching its preserved artifact by atomically placing the same marker with `"runtimeCorrection": true`; the worker records the prior completed attempt and exposes `reason: "runtime-correction"`. This operator-only path remains blocked after judgement and still requires the fixed 3,000-iteration ceiling.

## Verification

1. `node --check` passes for worker and participant runner.
2. Prompt and payload hashes match the web build.
3. Worker state reports `ready` and a fresh heartbeat without creating a participant sandbox.
4. Lab state endpoint reports two unprovisioned slots and execution enabled only while worker heartbeat is fresh.
5. Starting is explicit; deployment alone never starts a run.
6. During a run, both sandboxes pass the security probe before the randomized first participant begins.
7. Completed workspaces download under the run directory and render only through sandboxed, CSP-restricted preview routes. Variant C additionally preserves `weave.json` and periodic weave checkpoints.
8. Human scores are recorded before graph/transcript labels are revealed; Variant C is explicitly identified as exploratory and does not alter those scores.
9. Infinite v8 remains stopped/unchanged and its named `/data` state survives deployment.
