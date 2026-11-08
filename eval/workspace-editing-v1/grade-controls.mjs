import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getWorkspaceEditingCases, gradeWorkspaceEditingCase } from "./grader.mjs";

const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
const spec = getWorkspaceEditingCases();
const results = [];

for (const item of spec.cases) {
  const oracle = await gradeSnapshot(item, item.expectedFiles, item.expectedFinalAnswer === undefined ? "" : JSON.stringify(item.expectedFinalAnswer));
  assert(oracle.grade.taskOutcome, `${item.id} oracle must pass: ${oracle.failures.join("; ")}`);
  results.push({ control: `${item.id}-oracle`, expected: true, ...oracle });

  const wrong = wrongControl(item);
  const negative = await gradeSnapshot(item, wrong.files, wrong.finalAnswer ?? "");
  assert(!negative.grade.taskOutcome, `${item.id} negative must fail`);
  results.push({ control: `${item.id}-${wrong.name}`, expected: false, ...negative });
}

const scopeCase = spec.cases.find((item) => item.id === "SDKWS-02");
const scopeFiles = { ...scopeCase.expectedFiles, "extra.txt": "not allowed\n", "fixtures/reference.json": "{}\n" };
const scopeNegative = await gradeSnapshot(scopeCase, scopeFiles, "");
assert(!scopeNegative.grade.taskOutcome && !scopeNegative.grade.fileScope && !scopeNegative.grade.readOnlyUnchanged, "scope/read-only control must fail distinctly");
results.push({ control: "SDKWS-02-extra-and-read-only-change", expected: false, ...scopeNegative });

const unsafeCase = spec.cases.find((item) => item.id === "SDKWS-01");
const unsafeFiles = { ...unsafeCase.expectedFiles, "assets/panel.svg": unsafeCase.expectedFiles["assets/panel.svg"].replace("<svg ", "<svg onload=\"steal()\" ") };
const unsafeNegative = await gradeSnapshot(unsafeCase, unsafeFiles, "");
assert(!unsafeNegative.grade.taskOutcome && !unsafeNegative.grade.artifactSafety, "unsafe SVG control must fail distinctly");
results.push({ control: "SDKWS-01-unsafe-event-handler", expected: false, ...unsafeNegative });

const noOpCase = spec.cases.find((item) => item.id === "SDKWS-03");
const reformattedFiles = { "settings/manual.json": JSON.stringify(JSON.parse(noOpCase.expectedFiles["settings/manual.json"])) };
const reformatted = await gradeSnapshot(noOpCase, reformattedFiles, JSON.stringify(noOpCase.expectedFinalAnswer));
assert(!reformatted.grade.taskOutcome && !reformatted.grade.workspaceCorrect && reformatted.grade.answerCorrect, "already-correct case must reject needless rewrites without rejecting the correct answer");
results.push({ control: "SDKWS-03-needless-reformat", expected: false, ...reformatted });

const duplicateCase = spec.cases.find((item) => item.id === "SDKWS-02");
const duplicateFiles = { ...duplicateCase.expectedFiles, "fixtures/viewer.json": duplicateCase.expectedFiles["fixtures/viewer.json"].replace('{\n  "workspace": "sdk-demo",', '{\n  "workspace": "sdk-demo",\n  "workspace": "shadow",') };
const duplicate = await gradeSnapshot(duplicateCase, duplicateFiles, "");
assert(!duplicate.grade.taskOutcome && !duplicate.grade.workspaceCorrect, "duplicate JSON keys must fail");
results.push({ control: "SDKWS-02-duplicate-json-key", expected: false, ...duplicate });

const summary = {
  generatedAt: new Date().toISOString(),
  kind: "offline deterministic grader controls",
  providerCalls: 0,
  cases: spec.cases.length,
  controls: results.length,
  passedExpectations: results.filter((result) => result.grade.taskOutcome === result.expected).length,
  results
};
assert(summary.passedExpectations === results.length, "every control must match its expected outcome");
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
}
process.stdout.write(serialized);

async function gradeSnapshot(item, files, finalAnswer) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-workspace-grader-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const destination = path.join(root, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
    return await gradeWorkspaceEditingCase({ caseId: item.id, workspaceDir: root, finalAnswer });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function wrongControl(item) {
  const files = { ...item.expectedFiles };
  switch (item.id) {
    case "SDKWS-01":
      files["assets/panel.svg"] = files["assets/panel.svg"].replace('width="36"', 'width="48"').replace("SDK queued", "SDK ready");
      return { name: "stale-revisions", files };
    case "SDKWS-02": {
      const value = JSON.parse(files["fixtures/viewer.json"]);
      value.export.transparent = "false";
      files["fixtures/viewer.json"] = JSON.stringify(value);
      return { name: "string-false", files };
    }
    case "SDKWS-03":
      return { name: "empty-answer", files, finalAnswer: "" };
    case "SDKWS-04": {
      const value = JSON.parse(files["fixtures/cards.json"]);
      value.cards[1].label = "Review";
      files["fixtures/cards.json"] = JSON.stringify(value);
      return { name: "blanket-label-replacement", files };
    }
    case "SDKWS-05": {
      const value = JSON.parse(files["docs/preview.json"]);
      value.title = "Wave mark";
      value.activeId = "beta";
      value.activeFile = "beta.svg";
      files["docs/preview.json"] = JSON.stringify(value);
      return { name: "stale-preview-selection", files };
    }
    default:
      throw new Error(`No negative control for ${item.id}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
