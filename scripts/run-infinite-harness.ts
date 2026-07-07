import "dotenv/config";
import { InfiniteHarness } from "../src/evals/infiniteHarness.js";

const batches = Number(process.argv.find((arg) => arg.startsWith("--batches="))?.split("=")[1] ?? "1");
const batchSize = Number(process.argv.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1] ?? "25");
const selfImprove = process.argv.includes("--self-improve");
const statePath = process.argv.find((arg) => arg.startsWith("--state="))?.split("=")[1] ?? "/tmp/stateweave-infinite-state.json";

const harness = new InfiniteHarness({ batches, batchSize, selfImprove, statePath });

process.on("SIGINT", async () => {
  console.log("\nstopping...");
  await harness.stop();
  process.exit(0);
});

const state = await harness.run((live) => {
  const last = live.turns.at(-1);
  if (last) console.log(`[batch ${last.batch} turn ${last.turn}] ${last.nodeCount}n ${last.clusterCount}c ~${last.promptTokenEstimate}tok ${last.latencyMs}ms — ${last.prompt.slice(0, 60)}`);
});

console.log(`\nDone: ${state.turnCount} turns, ${state.reviews.length} reviews, ${state.graphSnapshot?.nodeCount ?? 0} nodes, ${state.graphSnapshot?.clusterCount ?? 0} clusters.`);
