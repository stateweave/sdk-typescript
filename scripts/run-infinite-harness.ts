import "dotenv/config";
import { InfiniteHarness } from "../src/evals/infiniteHarness.js";

const batches = Number(process.argv.find((arg) => arg.startsWith("--batches="))?.split("=")[1] ?? "1");
const batchSize = Number(process.argv.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1] ?? "50");
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
  if (last) {
    const score = last.score ? ` SW:${last.score.stateweave.score} naive:${last.score.naive.score} win:${last.score.windowed.score}` : "";
    console.log(`[t${last.turn} ${last.phase}] ${last.nodeCount}n SW~${last.promptTokenEstimate}tok naive~${last.baselineTokenEstimate}tok win~${last.windowedTokenEstimate}tok${score} — ${last.prompt.slice(0, 50)}`);
  }
});

console.log(`\nDone: ${state.turnCount} turns, ${state.probes.length} probes, ${state.consistencyChecks.length} consistency checks.`);
if (state.finalReport) {
  console.log(`\n=== FINAL REPORT ===\n${state.finalReport.summary}\nVerdict: ${state.finalReport.verdict}`);
  console.log(`Strengths: ${state.finalReport.strengths.join("; ")}`);
  console.log(`Weaknesses: ${state.finalReport.weaknesses.join("; ")}`);
}
