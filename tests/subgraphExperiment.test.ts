import { describe, expect, it } from "vitest";
import { compileCompound, compileFlat, fixtureDigest, scoreOutput, subgraphExperimentCases } from "../src/web/subgraphExperiment.js";

const cases = subgraphExperimentCases();

describe("compound-node experiment", () => {
  it("defines ten disjoint objective cases with a stable digest", () => {
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(10);
    expect(new Set(cases.map((testCase) => testCase.category)).size).toBe(10);
    expect(fixtureDigest()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("renders one compound as both an outer node and an expanded subgraph", () => {
    const prompt = compileCompound(cases[1]!);
    expect(prompt).toContain("COMPOUND_WEAVE/1");
    expect(prompt).toContain("COMPOUND_NODE cmp_cedar");
    expect(prompt).toContain('<EXPANDED id="cmp_cedar"');
    expect(prompt).toContain("PORT cmp_cedar --priced_by--> atom:fuel_price");
    expect(prompt).toContain("ATOM fuel_price");
  });

  it("supports a compound-to-compound edge and overlapping atom membership", () => {
    const compoundJoin = compileCompound(cases[2]!);
    expect(compoundJoin).toContain("PORT cmp_nimbus_selection --feeds--> cmp_nimbus_capacity");
    expect(compoundJoin).toContain('<EXPANDED id="cmp_nimbus_selection"');
    expect(compoundJoin).toContain('<EXPANDED id="cmp_nimbus_capacity"');

    const overlap = compileCompound(cases[4]!);
    expect(overlap).toContain("ATOM glass_safety_margin");
    expect(overlap).toContain("ATOM_REF glass_safety_margin");
  });

  it("never sends gold answers through either arm", () => {
    for (const testCase of cases) {
      const compoundPrompt = compileCompound(testCase);
      const flatPrompt = compileFlat(testCase);
      for (const gold of testCase.gold.answers) {
        expect(compoundPrompt).not.toContain(`GOLD: ${gold}`);
        expect(flatPrompt).not.toContain(`GOLD: ${gold}`);
      }
      expect(compoundPrompt).toContain(testCase.question);
      expect(flatPrompt).toContain(testCase.question);
    }
  });

  it("scores answer, evidence completeness, and stale evidence separately", () => {
    const testCase = cases[0]!;
    const prompt = compileCompound(testCase);
    const pass = scoreOutput(testCase, "compound", 1, prompt, {
      text: 'FINAL: {"answer":"432 sensors ship to Kyoto","evidence":["orchard_city","orchard_crates","orchard_units"]}'
    }, 10);
    expect(pass).toMatchObject({ formatValid: true, answerCorrect: true, evidenceComplete: true, evidenceClean: true, fullPass: true });

    const stale = scoreOutput(testCase, "flat", 2, prompt, {
      text: 'FINAL: {"answer":"432 sensors to Kyoto","evidence":["orchard_city","orchard_crates","orchard_units","orchard_crates_draft"]}'
    }, 10);
    expect(stale).toMatchObject({ answerCorrect: true, evidenceComplete: true, evidenceClean: false, fullPass: false });
  });
});
