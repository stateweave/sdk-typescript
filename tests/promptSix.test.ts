import { describe, expect, it } from "vitest";
import { promptSixCases, promptSixCategoryCounts, promptSixCategoryOrder, promptSixHypothesis } from "../web/src/promptSix.js";

describe("prompt six long-context regression eval data", () => {
  const cases = promptSixCases();

  it("has 300 cases balanced across five primary categories", () => {
    expect(cases).toHaveLength(300);
    expect(promptSixCategoryOrder).toHaveLength(5);
    for (const category of promptSixCategoryOrder) {
      expect(cases.filter((item) => item.categories.includes(category))).toHaveLength(promptSixCategoryCounts[category]);
    }
  });

  it("has unique prompts, non-empty gold answers, and one primary category", () => {
    expect(new Set(cases.map((item) => item.prompt)).size).toBe(cases.length);
    for (const item of cases) {
      expect(item.prompt.trim()).toBeTruthy();
      expect(item.expect.trim()).toBeTruthy();
      expect(item.categories).toHaveLength(1);
    }
  });

  it("locks representative deterministic oracle answers", () => {
    expect(cases[0].categories).toEqual(["anchor-recall"]);
    expect(cases[0].expect).toBe("Deltan-HAR-01~Cairo~egret~527");
    expect(cases[4].categories).toEqual(["cross-reference"]);
    expect(cases[4].expect).toBe("Deltan-HAR-01|Yara|1|1|2798");
    expect(cases[149].categories).toEqual(["cross-reference"]);
    expect(cases[149].expect).toBe("Yara-ORI-07|Juno|25|21|95");
    expect(cases[299].categories).toEqual(["cross-reference"]);
    expect(cases[299].expect).toBe("Junia-JUN-25|Yara|27|40|2599");
  });

  it("states a falsifiable regression hypothesis", () => {
    expect(promptSixHypothesis.thesis).toContain("context grows");
    expect(promptSixHypothesis.successSignal).toContain("regression");
  });
});
