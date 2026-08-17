import { describe, expect, it } from "vitest";
import { compileCompound, compileFlat, fixtureDigest, scoreOutput, subgraphExperimentCases } from "../src/web/subgraphExperiment.js";

const cases = subgraphExperimentCases();
const findCase = (id: string) => cases.find((testCase) => testCase.id === id)!;

describe("compound-node hard experiment", () => {
  it("preregisters twenty-two new disjoint objective cases with a stable digest", () => {
    expect(cases).toHaveLength(22);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(22);
    expect(new Set(cases.map((testCase) => testCase.category)).size).toBe(22);
    expect(cases.every((testCase) => testCase.id.startsWith("hard-"))).toBe(true);
    expect(fixtureDigest()).toBe("43db70d7647f56298dc71a18c64a4bfa00ca5ee0673cc771463804fc8add9092");
  });

  it("renders compounds as outer nodes and connected expanded subgraphs", () => {
    const prompt = compileCompound(findCase("hard-sable-invoice"));
    expect(prompt).toContain("COMPOUND_WEAVE/1");
    expect(prompt).toContain("COMPOUND_NODE cmp_sable_goods");
    expect(prompt).toContain('<EXPANDED id="cmp_sable_goods"');
    expect(prompt).toContain("PORT cmp_sable_goods --feeds--> cmp_sable_discount");
  });

  it("supports ordinary-node ports and overlapping membership", () => {
    const boundary = compileCompound(findCase("hard-delta-trucks"));
    expect(boundary).toContain("PORT cmp_delta_rounding --requires--> atom:delta_spare_rule");
    expect(boundary).toContain("ATOM delta_spare_rule");

    const overlap = compileCompound(findCase("hard-kestrel-capacity"));
    expect(overlap).toContain("ATOM kestrel_shared_backup");
    expect(overlap).toContain("ATOM_REF kestrel_shared_backup");
  });

  it("makes every required evidence atom visible to the compound arm", () => {
    for (const testCase of cases) {
      const prompt = compileCompound(testCase);
      for (const key of testCase.gold.requiredEvidence) expect(prompt, `${testCase.id} omitted ${key}`).toMatch(new RegExp(`ATOM(?:_REF)? ${key}(?:\\s|$)`));
    }
  });

  it("never sends gold labels through either arm", () => {
    for (const testCase of cases) {
      const compoundPrompt = compileCompound(testCase);
      const flatPrompt = compileFlat(testCase);
      expect(compoundPrompt).toContain(testCase.question);
      expect(flatPrompt).toContain(testCase.question);
      expect(compoundPrompt).not.toContain("GOLD:");
      expect(flatPrompt).not.toContain("GOLD:");
    }
  });

  it("scores answer, evidence completeness, and forbidden evidence separately", () => {
    const testCase = findCase("hard-polaris-yield");
    const prompt = compileCompound(testCase);
    const pass = scoreOutput(testCase, "compound", 1, prompt, {
      text: 'FINAL: {"answer":"180 units","evidence":["polaris_input","polaris_loss","polaris_rejects","polaris_recovered","polaris_reserve"]}'
    }, 10);
    expect(pass).toMatchObject({ formatValid: true, answerCorrect: true, evidenceComplete: true, evidenceClean: true, fullPass: true });

    const stale = scoreOutput(testCase, "flat", 2, prompt, {
      text: 'FINAL: {"answer":"180 units","evidence":["polaris_input","polaris_loss","polaris_rejects","polaris_recovered","polaris_reserve","polaris_old_yield"]}'
    }, 10);
    expect(stale).toMatchObject({ answerCorrect: true, evidenceComplete: true, evidenceClean: false, fullPass: false });
  });
});
