import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { listChallengerScenarios, readChallengerScenario } from "../src/evals/challengerScenarioLibrary.js";

const scenario = (id: string, turns = 4) => `---
id: ${id}
title: Scenario ${id}
tldr: A private long-running test.
domain: product
estimated_turns: ${turns}
status: draft
---

# Scenario ${id}

Participant instructions.
`;

it("lists curated Markdown scenarios and returns reviewable bodies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "challenger-scenarios-"));
  try {
    await mkdir(root, { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "02-second.md"), scenario("second", 7)),
      writeFile(path.join(root, "01-first.md"), scenario("first", 5)),
      writeFile(path.join(root, "ignore.txt"), "not a scenario")
    ]);

    const summaries = await listChallengerScenarios(root);
    const first = await readChallengerScenario(root, "01-first.md");

    expect(summaries.map((item) => item.filename)).toEqual(["01-first.md", "02-second.md"]);
    expect(first).toMatchObject({ id: "first", title: "Scenario first", estimatedTurns: 5, status: "draft" });
    expect(first?.markdown).toContain("# Scenario first");
    expect(first?.markdown).not.toContain("estimated_turns");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects traversal and missing scenario files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "challenger-scenarios-safe-"));
  try {
    expect(await readChallengerScenario(root, "../secret.md")).toBeUndefined();
    expect(await readChallengerScenario(root, "missing.md")).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
