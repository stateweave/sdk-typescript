import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditSourceRoot, auditToyJudge, auditWebGraders, loadPureFunctions } from "../scripts/audit-eval-graders.js";
import { judge } from "../src/evals/judge.js";

const correct = "The refresh token is not updating the session. Do not rewrite the auth system.";

describe("offline grader audit", () => {
  it("accepts a final-answer-only toy oracle and rejects all negative controls", () => {
    const controls = auditToyJudge((_task, result) => ({ success: result.finalAnswer === correct }));
    expect(controls).toHaveLength(6);
    expect(controls.every((item) => item.passed)).toBe(true);
  });

  it("detects an always-passing toy grader rather than trusting a positive control", () => {
    const controls = auditToyJudge(() => ({ success: true }));
    expect(controls.filter((item) => !item.passed)).toHaveLength(5);
  });

  it("uses the actual toy function, with the same result as a normal module import", () => {
    const source = readFileSync(new URL("../src/evals/judge.ts", import.meta.url), "utf8");
    const extracted = loadPureFunctions<{ judge: typeof judge }>(source, ["judge"]);
    expect(auditToyJudge(extracted.judge)).toEqual(auditToyJudge(judge));
  });

  it("accepts complete vote labels and unscored invalid responses", () => {
    const controls = auditWebGraders({
      parseJudgeVote(raw) {
        const vote = raw.match(/^WINNER: (BOTH|NEITHER|A|B)\b/m)?.[1]?.toLowerCase();
        return { vote };
      },
      coerceJudgeVote(parsed) { return parsed; }
    });
    expect(controls).toHaveLength(7);
    expect(controls.every((item) => item.passed)).toBe(true);
  });

  it("detects prefix matches, scored parse errors, and wrong-answer promotion", () => {
    const controls = auditWebGraders({
      parseJudgeVote(raw) { return { vote: raw.match(/WINNER:\s*(A|B|BOTH|NEITHER)/)?.[1]?.toLowerCase() ?? "neither" }; },
      coerceJudgeVote() { return { vote: "both" }; }
    });
    expect(controls.filter((item) => !item.passed).map((item) => item.id)).toEqual([
      "web.label-both", "web.malformed-unscored", "web.prefix-label-unscored", "web.identical-wrong-not-promoted"
    ]);
  });

  it("does not execute top-level provider/server initialization or load imports", () => {
    const source = 'import "dotenv/config"; throw new Error("server started"); export function pure(value: string): string { return value.toUpperCase(); }';
    const functions = loadPureFunctions<{ pure(value: string): string }>(source, ["pure"]);
    expect(functions.pure("offline")).toBe("OFFLINE");
  });

  it("fails loudly when a required function is missing or duplicated", () => {
    expect(() => loadPureFunctions("const noFunction = 1;", ["judge"])).toThrow("Expected one function declaration");
    expect(() => loadPureFunctions("function judge() {} function judge() {}", ["judge"])).toThrow("Expected one function declaration");
  });

  it("reports missing web graders as unavailable, not validated", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sw-offline-audit-"));
    try {
      mkdirSync(path.join(root, "src/evals"), { recursive: true });
      writeFileSync(path.join(root, "src/evals/judge.ts"), "export function judge(task: unknown, result: {finalAnswer: string}) { return {success: result.finalAnswer === " + JSON.stringify(correct) + "}; }");
      const audit = auditSourceRoot(root);
      expect(audit).toMatchObject({ passed: 6, failed: 0 });
      expect(audit.unavailable).toEqual(["Web graders: src/web/server.ts is absent from this source tree."]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
