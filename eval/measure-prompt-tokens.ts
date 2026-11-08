// Offline prompt-size comparison: re-serializes GraphFrames stored in an eval result with the current
// serializer and compares against the prompt that was actually sent for that frame. No provider calls.
//
//   npm run measure:tokens -- <result.json> [more result.json …]
import { readFile } from "node:fs/promises";
import { serializeGraphFrame } from "../src/core/serialize.js";
import { estimateStateWeaveTokens } from "../src/llm/tokenizer.js";
import type { GraphFrame } from "../src/core/types.js";

type Sample = { caseId: string; before: number; after: number };
type StoredCall = { input?: { prompt?: string; frame?: GraphFrame } };
type StoredStep = { prompt?: string; frameBefore?: GraphFrame };
type StoredCase = { caseId: string; graph?: { audited?: { failure?: { evidence?: { graphCalls?: StoredCall[]; failedGraphTrace?: StoredStep[] } } } } };

const tokens = (text: string) => estimateStateWeaveTokens(text).estimatedTokens;

function samplesFor(item: StoredCase): Sample[] {
  const evidence = item.graph?.audited?.failure?.evidence;
  const pairs = [
    ...(evidence?.graphCalls ?? []).map((call) => ({ prompt: call.input?.prompt, frame: call.input?.frame })),
    ...(evidence?.failedGraphTrace ?? []).map((step) => ({ prompt: step.prompt, frame: step.frameBefore }))
  ];
  return pairs.flatMap(({ prompt, frame }) => (prompt && frame ? [{ caseId: item.caseId, before: tokens(prompt), after: tokens(serializeGraphFrame(frame)) }] : []));
}

function summarize(label: string, samples: Sample[]): string {
  const before = samples.reduce((sum, sample) => sum + sample.before, 0);
  const after = samples.reduce((sum, sample) => sum + sample.after, 0);
  const change = before ? ((after - before) / before) * 100 : 0;
  return `${label.padEnd(10)} n=${String(samples.length).padStart(3)}  before=${String(before).padStart(8)}  after=${String(after).padStart(8)}  change=${change.toFixed(1)}%`;
}

async function main(paths: string[]): Promise<void> {
  if (!paths.length) throw new Error("usage: measure-prompt-tokens <result.json> [...]");
  const samples: Sample[] = [];
  for (const file of paths) {
    const result = JSON.parse(await readFile(file, "utf8")) as { cases?: StoredCase[] };
    samples.push(...(result.cases ?? []).flatMap(samplesFor));
  }
  const caseIds = [...new Set(samples.map((sample) => sample.caseId))];
  for (const caseId of caseIds) console.log(summarize(caseId, samples.filter((sample) => sample.caseId === caseId)));
  console.log(summarize("TOTAL", samples));
}

await main(process.argv.slice(2));
