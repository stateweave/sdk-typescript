import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseTokenUsageHistory, renderDualTokenUsageView } from "../web/src/tokenUsage.js";

it("pins the independent twelve-case pilot before inference", () => {
  const bytes = readFileSync(new URL("../evaluations/jev-focus-v1/cases.json",import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("1383bb9de5b180598ea2e76d9e0e275129f5c7a3f4f3890dbfa0015d1d9d02e4");
  const cases = JSON.parse(bytes.toString());
  expect(cases).toHaveLength(12);
  expect(new Set(cases.map((c: {id:string})=>c.id)).size).toBe(12);
  for (const category of ["cross-branch","paraphrase","supersession","control"]) expect(cases.filter((c:{category:string})=>c.category===category)).toHaveLength(3);
});

it("restores and renders Jev overhead separately from main-model accounting", () => {
  const points=parseTokenUsageHistory([{turn:1,runId:"test",startedAt:"2026-09-23",latestContextTokens:100,totalInputTokens:250,outputTokens:30,modelCalls:2,status:"done",focus:{status:"ranked",mode:"hierarchical",calls:3,inputTokens:800,outputTokens:45,latencyMs:850,usageIncomplete:false}}]);
  expect(points[0]?.totalInputTokens).toBe(250);
  expect(points[0]?.focus?.inputTokens).toBe(800);
  const view=renderDualTokenUsageView(points,[]);
  expect(view.html).toContain("separate overhead");
  expect(view.html).toContain("Jev ranked");
  expect(view.html).toContain("+800 input / 45 output");
});
