import { describe, expect, it } from "vitest";
import { MockModel } from "../src/llm/model.js";
import { buildLongHorizonDirectorPrompt, generateLongHorizonPrompt, normalizeLongHorizonPrompt } from "../src/web/longHorizonDirector.js";
import type { DualSessionView, DualTurnView } from "../src/web/dualSessionTypes.js";

function session(turns: DualTurnView[] = []): DualSessionView {
  return {
    sessionId: "swd_0123456789abcdef0123456789abcdef",
    turnCount: turns.length,
    storage: "jsonl-dual",
    stateweave: { history: [], usageHistory: [] },
    traditional: { history: [], usageHistory: [], activeMessageCount: 0, activeContext: "", totalCompactions: 0, totalCompactionAttempts: 0 },
    turns,
    historyTruncated: false,
    logBytes: 0
  };
}

function turn(index: number, input: string): DualTurnView {
  return {
    turn: index,
    turnId: `turn_${String(index).padStart(4, "0")}_0123456789abcdef`,
    input,
    timestamp: new Date(2026, 0, index).toISOString(),
    stateweave: { status: "done", answer: `StateWeave answer ${index}` },
    traditional: { status: "done", answer: `Traditional answer ${index}` }
  };
}

describe("long-horizon director", () => {
  it("gives the model both paired answers while requiring a standalone task", () => {
    const prompt = buildLongHorizonDirectorPrompt(session([turn(1, "Create a panda SVG")]));
    expect(prompt).toContain("LONG_HORIZON_DIRECTOR/1");
    expect(prompt).toContain("STATEWEAVE: StateWeave answer 1");
    expect(prompt).toContain("TRADITIONAL: Traditional answer 1");
    expect(prompt).toContain("fully standalone");
    expect(prompt).toContain("Return only the user input");
  });

  it("bounds old transcript material while retaining recent turns", () => {
    const prompt = buildLongHorizonDirectorPrompt(session([
      turn(1, `OLDEST_MARKER ${"x".repeat(45_000)}`),
      turn(2, "NEWEST_MARKER")
    ]));
    expect(prompt).not.toContain("OLDEST_MARKER");
    expect(prompt).toContain("NEWEST_MARKER");
  });

  it("normalizes wrappers and rejects context-dependent output", () => {
    expect(normalizeLongHorizonPrompt('<prompt>Design a self-contained CSV schema for a small library catalog.</prompt>')).toBe("Design a self-contained CSV schema for a small library catalog.");
    expect(() => normalizeLongHorizonPrompt("Continue the previous answer and update it.")).toThrow(/context-dependent/);
  });

  it("generates one standalone prompt with the configured model", async () => {
    const generated = await generateLongHorizonPrompt(new MockModel(), session([turn(1, "Create a panda SVG")]));
    expect(generated.prompt).toBe("Explain why ocean tides occur and distinguish the roles of the Moon and the Sun. Keep the answer under 200 words.");
  });

  it("rejects a prompt already used in the session", async () => {
    const repeated = "Explain why ocean tides occur and distinguish the roles of the Moon and the Sun. Keep the answer under 200 words.";
    await expect(generateLongHorizonPrompt(new MockModel(), session([turn(1, repeated)]))).rejects.toThrow(/repeated/);
  });
});
