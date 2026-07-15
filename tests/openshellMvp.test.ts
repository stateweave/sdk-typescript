import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const root = new URL("../ops/openshell-mvp/", import.meta.url);

it("pins the OpenShell MVP to fail-closed filesystem and network policy", async () => {
  const policy = await readFile(new URL("policy.yaml", root), "utf8");
  expect(policy).toContain("compatibility: hard_requirement");
  expect(policy).toContain("run_as_user: sandbox");
  expect(policy).toContain("run_as_group: sandbox");
  expect(policy).toMatch(/read_write:\n\s+- \/sandbox\n\s+- \/tmp/);
  expect(policy).toContain("network_policies: {}");
  expect(policy).not.toMatch(/best_effort|\/root|docker\.sock/);
});

it("routes StateWeave inference without exposing a real credential", async () => {
  const runner = await readFile(new URL("run.mjs", root), "utf8");
  expect(runner).toContain('baseUrl: "https://inference.local"');
  expect(runner).toContain('apiKey: "unused"');
  expect(runner).toContain("StateWeave must not run as root");
  expect(runner).toContain("a real model credential reached the agent process");
  expect(runner).toContain("Treat filesystem, process, network, and inference policy denials as hard security boundaries");
});

it("keeps an executable sandbox escape regression probe", async () => {
  const probe = await readFile(new URL("security-probe.mjs", root), "utf8");
  for (const invariant of ["rootSsh", "dockerSocket", "outsideWrite", "directNetwork", "realAnthropicKeyVisible"]) {
    expect(probe).toContain(invariant);
  }
  expect(probe).toContain('writeFile("/sandbox/output/security-report.json"');
});
