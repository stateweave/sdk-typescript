import { access, mkdir, readFile, writeFile } from "node:fs/promises";

const results = {};
const expectDenied = async (name, work) => {
  try {
    await work();
    results[name] = { denied: false };
  } catch (error) {
    results[name] = { denied: true, code: error?.code ?? error?.cause?.code ?? error?.name ?? "error" };
  }
};

await mkdir("/sandbox/workspace", { recursive: true });
await writeFile("/sandbox/workspace/probe.txt", "sandbox-write-ok\n", "utf8");
results.workspace = { readable: (await readFile("/sandbox/workspace/probe.txt", "utf8")) === "sandbox-write-ok\n" };
results.identity = { uid: typeof process.getuid === "function" ? process.getuid() : null, nonRoot: process.getuid?.() !== 0 };
results.credentials = { realAnthropicKeyVisible: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "unused") };

await expectDenied("rootSsh", () => access("/root/.ssh"));
await expectDenied("dockerSocket", () => access("/var/run/docker.sock"));
await expectDenied("outsideWrite", () => writeFile("/etc/stateweave-openshell-probe", "blocked", "utf8"));
await expectDenied("directNetwork", async () => {
  const response = await fetch("https://example.com", { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
});

const passed = results.workspace.readable
  && results.identity.nonRoot
  && !results.credentials.realAnthropicKeyVisible
  && results.rootSsh.denied
  && results.dockerSocket.denied
  && results.outsideWrite.denied
  && results.directNetwork.denied;
const report = { passed, results };
await mkdir("/sandbox/output", { recursive: true });
await writeFile("/sandbox/output/security-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
if (!passed) process.exitCode = 1;
