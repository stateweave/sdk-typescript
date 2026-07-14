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

it("ships a balanced 24-scenario, 180-turn review corpus", async () => {
  const root = path.resolve(process.cwd(), "data/challenger-scenarios");
  const summaries = await listChallengerScenarios(root);
  const domains = Object.fromEntries([...new Set(summaries.map((scenario) => scenario.domain))].map((domain) => [domain, summaries.filter((scenario) => scenario.domain === domain).length]));

  expect(summaries).toHaveLength(24);
  expect(new Set(summaries.map((scenario) => scenario.id)).size).toBe(24);
  expect(summaries.reduce((sum, scenario) => sum + scenario.estimatedTurns, 0)).toBe(180);
  expect(Object.values(domains)).toEqual(Array(8).fill(3));

  for (const summary of summaries) {
    const scenario = await readChallengerScenario(root, summary.filename);
    const markdown = scenario?.markdown ?? "";
    const section = (heading: string): string => markdown.match(new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n\\n## |$)`))?.[1] ?? "";
    const listItemCount = (value: string): number => value.match(/^(?:- |\d+\. )/gm)?.length ?? 0;

    expect(markdown).toContain("## TL;DR");
    expect(markdown).toContain("## Why this scenario exists");
    expect(markdown).toContain("## Hidden acceptance criteria");
    expect(markdown).toContain("## Behavioral verification");
    expect(markdown).toContain("## Quality rubric");
    expect(markdown).toContain("## Challenger notes");
    expect(markdown.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(600);
    expect(markdown.match(/^### Turn \d+/gm)?.length ?? 0).toBe(summary.estimatedTurns);
    expect(markdown.match(/^> /gm)?.length ?? 0).toBe(summary.estimatedTurns);
    expect(listItemCount(section("Hidden acceptance criteria"))).toBeGreaterThanOrEqual(8);
    expect(listItemCount(section("Behavioral verification"))).toBeGreaterThanOrEqual(6);
    expect(listItemCount(section("Challenger notes"))).toBeGreaterThanOrEqual(4);
    const rubricScores = [...section("Quality rubric").matchAll(/: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(rubricScores.length).toBeGreaterThanOrEqual(6);
    expect(rubricScores.reduce((sum, score) => sum + score, 0)).toBe(100);
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
