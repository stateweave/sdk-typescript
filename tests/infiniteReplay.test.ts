import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runInfiniteReplay } from "../src/evals/infiniteReplay.js";
import type { InfiniteReplayTurn } from "../src/evals/infiniteHarness.js";
import type { Model, ModelInput, ModelToken } from "../src/llm/model.js";

it("replays the identical turn plan and emits live matched candidate scores", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sw-replay-"));
  const replayPath = path.join(dir, "plan.jsonl");
  const statePath = path.join(dir, "state.json");
  const plan: InfiniteReplayTurn[] = [
    { turn: 1, phase: "seed", prompt: "Remember that the access color is azure." },
    { turn: 2, phase: "probe", prompt: "What access color did I specify?", probe: { goldAnswer: "azure", assertions: ["azure"], difficulty: "recall", dependsOnTurn: 1, baselineScore: { score: "fail", reasoning: "missed" } } }
  ];
  await writeFile(replayPath, `${plan.map((turn) => JSON.stringify(turn)).join("\n")}\n`);

  let graphCalls = 0;
  const model: Model = {
    async complete(input: ModelInput) {
      if (input.mode === "text") return { text: '{"score":"pass","reasoning":"contains azure"}' };
      graphCalls += 1;
      return { text: graphCalls === 1
        ? 'SWX/1\n@edge system_root follows user_input_1\n@node fact_color fact "access color azure" status=active\n@edge user_input_1 creates fact_color\n@final "I will remember azure."'
        : 'SWX/1\n@edge fact_color addresses user_input_2\n@final "The access color is azure."' };
    },
    async *stream(): AsyncIterable<ModelToken> { /* replay uses complete */ }
  };

  const progress: number[] = [];
  const result = await runInfiniteReplay({ replayPath, statePath, model, judgeModel: model, onProgress: (state) => progress.push(state.turnCount) });
  const persisted = JSON.parse(await readFile(statePath, "utf8")) as typeof result;

  expect(result.status).toBe("done");
  expect(result.baselineScore).toBe(0);
  expect(result.candidateScore).toBe(100);
  expect(result.invalidTransactions).toBe(0);
  expect(progress).toEqual([1, 2]);
  expect(persisted.candidateScore).toBe(100);
});
