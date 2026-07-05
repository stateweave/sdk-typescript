import { describe, expect, it } from "vitest";
import { promptFiveCases, promptFiveCategoryCounts, promptFiveCategoryOrder } from "../web/src/promptFive.js";

describe("prompt five eval data", () => {
  const cases = promptFiveCases();

  it("has 100 cases balanced across ten primary categories", () => {
    expect(cases).toHaveLength(100);
    expect(promptFiveCategoryOrder).toHaveLength(10);

    for (const category of promptFiveCategoryOrder) {
      expect(cases.filter((item) => item.categories.includes(category))).toHaveLength(promptFiveCategoryCounts[category]);
    }
  });

  it("has unique non-empty prompts, gold answers, and exactly one primary category", () => {
    expect(new Set(cases.map((item) => item.prompt)).size).toBe(cases.length);
    for (const item of cases) {
      expect(item.prompt.trim()).toBeTruthy();
      expect(item.expect.trim()).toBeTruthy();
      expect(item.categories).toHaveLength(1);
    }
  });

  it("locks selected tricky gold answers", () => {
    expect(findCase("sum of the positive divisors of 84").expect).toBe("224");
    expect(findCase("9876 modulo 13").expect).toBe("9");
    expect(findCase("current Harbor gate").expect).toBe("21");
    expect(findCase("active vault value product modulo 100").expect).toBe("30");
    expect(findCase("authoritative budget minus original policy budget").expect).toBe("220");
    expect(findCase("target number plus thistle decoy").expect).toBe("459");
    expect(findCase("active robot -> package -> locker -> zone -> permit -> office").expect).toBe("R2 -> P8 -> L4 -> Zone Sigma -> Permit Silver -> Office East");
    expect(findCase("one CSV row with headers").expect).toBe("name,code,city\nAtlas,A17,Quito");
  });

  function findCase(needle: string) {
    const item = cases.find((candidate) => candidate.prompt.includes(needle));
    if (!item) throw new Error(`Missing prompt containing: ${needle}`);
    return item;
  }
});
