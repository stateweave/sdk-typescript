import "dotenv/config";
import { createModelFromEnv } from "../src/llm/factory.js";
import { runInfiniteReplay } from "../src/evals/infiniteReplay.js";

const replayPath = process.argv.find((arg) => arg.startsWith("--replay="))?.split("=")[1];
const statePath = process.argv.find((arg) => arg.startsWith("--state="))?.split("=")[1] ?? "/tmp/stateweave-infinite-replay.json";
if (!replayPath) throw new Error("--replay=<path> is required");

const state = await runInfiniteReplay({
  replayPath,
  statePath,
  model: createModelFromEnv(),
  judgeModel: createModelFromEnv(),
  onProgress(live) {
    console.log(`[replay ${live.turnCount}/${live.totalTurns}] baseline ${live.baselineScore}% candidate ${live.candidateScore}% · valid ${live.validTransactions}/${live.turnCount}`);
  }
});

console.log(JSON.stringify(state));
if (state.status !== "done") process.exitCode = 1;
