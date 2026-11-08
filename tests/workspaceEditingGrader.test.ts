import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

it("passes reference outputs and rejects workspace-editing negative controls", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["eval/workspace-editing-v1/grade-controls.mjs"], {
    cwd: process.cwd(),
    maxBuffer: 1_000_000
  });
  const report = JSON.parse(stdout) as {
    providerCalls: number;
    controls: number;
    passedExpectations: number;
    results: Array<{ control: string; grade: { taskOutcome: boolean; answerCorrect: boolean | null; workspaceCorrect: boolean } }>;
  };

  expect(report.providerCalls).toBe(0);
  expect(report.controls).toBe(14);
  expect(report.passedExpectations).toBe(report.controls);
  expect(report.results.find((item) => item.control === "SDKWS-03-oracle")?.grade).toMatchObject({ taskOutcome: true, answerCorrect: true });
  expect(report.results.find((item) => item.control === "SDKWS-03-empty-answer")?.grade).toMatchObject({ taskOutcome: false, workspaceCorrect: true, answerCorrect: false });
  expect(report.results.find((item) => item.control === "SDKWS-03-needless-reformat")?.grade).toMatchObject({ taskOutcome: false, workspaceCorrect: false, answerCorrect: true });
});
