import { describe, expect, it } from "vitest";
import { oneShotPromptStats, oneShotSdkBuildPrompt } from "../src/evals/oneShotSdkBenchmark.js";

describe("one-shot SDK build prompt", () => {
  it("is neutral and contains no experiment identity", () => {
    expect(oneShotSdkBuildPrompt).not.toMatch(/StateWeave|candidate|baseline|benchmark|scoring|reference site|existing SDK/i);
  });

  it("requires one complete SDK-backed implementation", () => {
    expect(oneShotSdkBuildPrompt).toContain("Complete this assignment autonomously in one uninterrupted run");
    expect(oneShotSdkBuildPrompt).toContain("All direct Desmos interaction must live inside the SDK");
    expect(oneShotSdkBuildPrompt).toContain("Design the SDK architecture and API yourself");
    expect(oneShotSdkBuildPrompt).toContain("complete interactive Stackelberg duopoly model with two charts");
  });

  it("contains the required economic verification values", () => {
    expect(oneShotSdkBuildPrompt).toContain("Leader quantity 45");
    expect(oneShotSdkBuildPrompt).toContain("Follower quantity 30");
    expect(oneShotSdkBuildPrompt).toContain("Total quantity 75");
    expect(oneShotSdkBuildPrompt).toContain("Market price 22.5");
    expect(oneShotSdkBuildPrompt).toContain("total quantity 54 and price 33");
  });

  it("stays concise enough to test the agent's own design decisions", () => {
    const stats = oneShotPromptStats();
    expect(stats.words).toBeGreaterThan(350);
    expect(stats.words).toBeLessThan(700);
    expect(stats.characters).toBe(oneShotSdkBuildPrompt.length);
    expect(oneShotSdkBuildPrompt.trim().split(/^## /m).length).toBe(4);
    expect(oneShotSdkBuildPrompt).not.toMatch(/dependency cycle|topological|second-order check|method signature/i);
  });
});
