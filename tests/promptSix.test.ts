import { describe, expect, it } from "vitest";
import { promptSixCases, promptSixCategoryCounts, promptSixCategoryOrder, promptSixHypothesis } from "../web/src/promptSix.js";

describe("prompt six long-context regression eval data", () => {
  const cases = promptSixCases();

  it("has 200 cases balanced across five primary categories", () => {
    expect(cases).toHaveLength(200);
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
    expect(cases[0].expect).toMatch(/^[A-Z]{3}-\d+\|[A-Za-z]+\|[a-z]+\|\d+$/);
    expect(cases[4].categories).toEqual(["cross-reference"]);
    expect(cases[4].expect.split("|")).toHaveLength(4);
    expect(cases[199].categories).toEqual(["cross-reference"]);
    expect(cases[199].expect.split("|")).toHaveLength(4);
  });

  it("states a falsifiable regression hypothesis", () => {
    expect(promptSixHypothesis.thesis).toContain("context grows");
    expect(promptSixHypothesis.successSignal).toContain("regression");
  });
});
