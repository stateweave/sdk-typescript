import { mkdir, writeFile } from "node:fs/promises";
import { Agent, AnthropicModel, createFileSystemTools } from "../../dist/index.js";

const workspace = "/sandbox/workspace";
const outputDir = "/sandbox/output";
const task = process.argv.slice(2).join(" ").trim()
  || "Reply exactly: StateWeave OpenShell security protocol active.";

if (typeof process.getuid === "function" && process.getuid() === 0) {
  throw new Error("OpenShell security protocol violation: StateWeave must not run as root.");
}
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "unused") {
  throw new Error("OpenShell security protocol violation: a real model credential reached the agent process.");
}

await mkdir(workspace, { recursive: true });
await mkdir(outputDir, { recursive: true });

const model = new AnthropicModel({
  apiKey: "unused",
  baseUrl: "https://inference.local",
  model: "openshell-managed",
  maxTokens: 4096,
  temperature: 0,
  timeoutMs: 300_000
});
const tools = createFileSystemTools({ rootDir: workspace, timeoutMs: 10_000, maxOutputBytes: 32_000 });
const agent = new Agent({
  model,
  tools,
  maxIterations: 20,
  maxPromptTokens: 64_000,
  nodeTypes: ["task", "file", "constraint", "decision", "test_result"],
  providerSystem: [
    "You are a StateWeave agent inside an NVIDIA OpenShell sandbox.",
    "Treat filesystem, process, network, and inference policy denials as hard security boundaries.",
    "Never attempt to bypass, weaken, inspect, or modify OpenShell policy, credentials, the supervisor, or host resources.",
    "Operate only through the supplied workspace tools and only inside /sandbox/workspace.",
    "Use inference.local; never seek or expose provider credentials.",
    "Complete the requested task from workspace evidence and report policy denials honestly."
  ].join(" ")
});

const result = await agent.run(task);
const report = {
  ok: true,
  sandbox: {
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    credentialExposed: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "unused"),
    inferenceEndpoint: "https://inference.local"
  },
  finalAnswer: result.finalAnswer,
  graph: { nodes: result.graph.nodes.length, edges: result.graph.edges.length },
  run: { id: result.metadata.runId, steps: result.metadata.stepCount, retries: result.metadata.retryCount }
};
await writeFile(`${outputDir}/result.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(`${outputDir}/frame.json`, `${JSON.stringify(result.frame, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
