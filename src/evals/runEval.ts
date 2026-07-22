import "dotenv/config";
import path from "node:path";
import { BaselineAgent } from "../agent/baselineAgent.js";
import { GraphFrameAgent } from "../agent/graphFrameAgent.js";
import { createModelFromEnv } from "../llm/factory.js";
import { mockTools } from "../tools/mockTools.js";
import { judge } from "./judge.js";
import { evalTasks } from "./tasks.js";

const model = createModelFromEnv();
const baseline = new BaselineAgent({ model, tools: mockTools });
const stateweave = new GraphFrameAgent({ model, tools: mockTools, maxIterations: 4, traceDir: path.resolve("src/traces") });

const rows: string[] = ["Task | Traditional messages success | StateWeave success | Traditional steps | StateWeave steps | Notes", "--- | --- | --- | --- | --- | ---"];

for (const task of evalTasks) {
  const baselineResult = await baseline.run(task);
  const stateResult = await stateweave.run(task);
  const baselineScore = judge(task, baselineResult);
  const stateScore = judge(task, stateResult);
  rows.push([
    task.id,
    baselineScore.success ? "yes" : "no",
    stateScore.success ? "yes" : "no",
    String(baselineResult.trace.length),
    String(stateResult.trace.length),
    `traditional: ${baselineScore.notes}; stateweave: ${stateScore.notes}`
  ].join(" | "));
}

console.log(rows.join("\n"));
