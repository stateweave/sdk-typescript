import { expect, it } from "vitest";
import { maxTokenUsageHistory, parseTokenUsageHistory, renderDualTokenUsageView, renderTokenUsageView, type TokenUsagePoint } from "../web/src/tokenUsage.js";

function point(turn: number, overrides: Partial<TokenUsagePoint> = {}): TokenUsagePoint {
  return {
    turn,
    runId: `sw_${turn}`,
    startedAt: "2026-08-18T12:00:00.000Z",
    completedAt: "2026-08-18T12:00:01.000Z",
    latestContextTokens: 1_000 + turn,
    peakContextTokens: 1_100 + turn,
    totalInputTokens: 2_000 + turn,
    outputTokens: 300 + turn,
    modelCalls: 2,
    maxPromptTokens: 64_000,
    projectionTargetTokens: 16_000,
    tokenCountSource: "provider",
    status: "done",
    ...overrides
  };
}

it("restores only bounded, valid settled usage records", () => {
  const input = [
    { nonsense: true },
    ...Array.from({ length: maxTokenUsageHistory + 5 }, (_, index) => point(index + 1))
  ];

  const restored = parseTokenUsageHistory(input);

  expect(restored).toHaveLength(maxTokenUsageHistory);
  expect(restored[0]?.turn).toBe(6);
  expect(restored.at(-1)?.turn).toBe(maxTokenUsageHistory + 5);
  expect(restored.at(-1)?.tokenCountSource).toBe("provider");
});

it("migrates records created before peak-context telemetry", () => {
  const legacy = point(1) as unknown as Record<string, unknown>;
  delete legacy.peakContextTokens;

  expect(parseTokenUsageHistory([legacy])[0]).toMatchObject({
    latestContextTokens: 1_001,
    peakContextTokens: 1_001
  });
});

it("renders paired StateWeave and traditional usage on one turn axis", () => {
  const rendered = renderDualTokenUsageView(
    [point(1, { totalInputTokens: 1_200, outputTokens: 80 })],
    [point(1, { runId: "traditional_1", totalInputTokens: 2_400, outputTokens: 120, projectionTargetTokens: 48_000, compactions: 1, compactionInputTokens: 900, compactionOutputTokens: 30, compactionModelCalls: 1 })]
  );

  expect(rendered.countLabel).toBe("1 paired turn");
  expect(rendered.html).toContain("Same input, two memory primitives");
  expect(rendered.html).toContain("Context carried into the final call");
  expect(rendered.html).toContain("StateWeave projection vs traditional active transcript; compaction appears as a drop");
  expect(rendered.html).toContain("Summed API input by turn");
  expect(rendered.html).toContain("Summed API output by turn");
  expect(rendered.html).toContain("Peak single request by turn");
  expect(rendered.html).toContain("chronological transcript is not replayed");
  expect(rendered.html).toContain("complete active <code>messages[]</code>");
  expect(rendered.html).toContain("Neither is context size");
  expect(rendered.html).toContain("900 summary input");
  expect(rendered.html).toContain("2 model calls · replayed transcript");
  expect(rendered.html).toContain("traditional input");
});

it("renders exact turn series, count provenance, and failed usage", () => {
  const rendered = renderTokenUsageView([
    point(1),
    point(2, { status: "failed", tokenCountSource: "estimated", totalInputTokens: 4_200, outputTokens: 550 })
  ]);

  expect(rendered.countLabel).toBe("2 turns");
  expect(rendered.html).toContain("Usage by turn");
  expect(rendered.html).toContain("Turn 2 · Turn input: 4,200 tokens · failed run");
  expect(rendered.html).toContain("SDK tokenizer estimate");
  expect(rendered.html).toContain("Failed runs are retained when usage was measurable.");
});
