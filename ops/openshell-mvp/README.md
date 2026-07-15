# StateWeave OpenShell MVP

This MVP runs the real TypeScript `Agent` inside NVIDIA OpenShell while retaining StateWeave's own workspace tool restrictions.

Security invariants:

- OpenShell `v0.0.52` is pinned and treated as alpha software.
- Landlock is a hard requirement; sandbox startup fails if it cannot be applied.
- The agent runs as the unprivileged `sandbox` user.
- Only `/sandbox` and `/tmp` are writable.
- Ordinary network access is default-deny.
- Model traffic uses `https://inference.local`; the real provider credential remains at the OpenShell gateway.
- StateWeave's scoped, symlink-safe, no-shell tools remain enabled as defense in depth.
- The provider system prompt requires the agent to treat all policy denials as hard boundaries.

`security-probe.mjs` verifies workspace writes while requiring denial of host/root files, the Docker socket, writes outside the workspace, direct internet access, and real credential visibility.

## Eve MVP

The isolated Eve installation pins OpenShell `v0.0.52`:

- Gateway: root user service on `https://127.0.0.1:17670` with mTLS.
- Compute driver: Docker.
- Sandbox: `stateweave-mvp`, limited to 1 CPU and 2 GiB RAM.
- Managed inference: provider `stateweave-zai`, model `glm-5.2`, 300-second timeout.
- Host staging and evidence: `/root/stateweave-openshell-mvp` (root-only).

The real provider key is stored by the OpenShell gateway. The StateWeave process sends a fake key to `inference.local`; the router strips it and applies the managed credential upstream.

Verify the deployed MVP:

```shell
openshell status
openshell sandbox get stateweave-mvp
openshell sandbox exec -n stateweave-mvp --timeout 30 \
  --workdir /sandbox/stateweave/runtime -- \
  node ops/openshell-mvp/security-probe.mjs
openshell sandbox exec -n stateweave-mvp --timeout 120 \
  --workdir /sandbox/stateweave/runtime -- \
  node ops/openshell-mvp/run.mjs
```

OpenShell `v0.0.52` fails Landlock startup when individual device files such as `/dev/null` or `/dev/urandom` are explicitly listed in a hard-requirement policy (`incompatible directory-only access-rights: ReadDir`). This policy lists directories only and still fails closed if Landlock cannot apply all five rules.

The MVP is intentionally separate from the Dokploy web runtime. Do not route the live lab through OpenShell until this alpha dependency passes repeated reliability and upgrade tests.
