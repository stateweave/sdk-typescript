import { describe, expect, it } from "vitest";
import { oneShotPromptStats, oneShotSdkBuildPrompt } from "../web/src/oneShotSdkBuild.js";

describe("one-shot SDK build prompt", () => {
  it("is neutral and contains no experiment identity", () => {
    expect(oneShotSdkBuildPrompt).not.toMatch(/StateWeave|candidate|baseline|benchmark|scoring|reference site|existing SDK/i);
  });

  it("requires one complete SDK-backed implementation", () => {
    expect(oneShotSdkBuildPrompt).toContain("Complete the entire assignment autonomously in this run");
    expect(oneShotSdkBuildPrompt).toContain("Direct Desmos API calls belong inside the SDK adapter only");
    expect(oneShotSdkBuildPrompt).toContain("Maintain a central expression registry");
    expect(oneShotSdkBuildPrompt).toContain("Track dependencies and update affected derived expressions");
    expect(oneShotSdkBuildPrompt).toContain("exactly two graph instances are created through the SDK");
  });

  it("contains the required economic verification values", () => {
    expect(oneShotSdkBuildPrompt).toContain("Leader quantity: \"q_L=45\"");
    expect(oneShotSdkBuildPrompt).toContain("Follower quantity: \"q_F=30\"");
    expect(oneShotSdkBuildPrompt).toContain("Total quantity: \"Q=75\"");
    expect(oneShotSdkBuildPrompt).toContain("Market price: \"P=22.5\"");
    expect(oneShotSdkBuildPrompt).toContain("total quantity \"54\" and price \"33\"");
  });

  it("is substantial but remains a single prompt", () => {
    const stats = oneShotPromptStats();
    expect(stats.words).toBeGreaterThan(1_200);
    expect(stats.characters).toBe(oneShotSdkBuildPrompt.length);
    expect(oneShotSdkBuildPrompt.trim().split(/^## /m).length).toBeGreaterThan(8);
  });
});
