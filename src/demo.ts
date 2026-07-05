import "dotenv/config";
import path from "node:path";
import { StateWeaveAgent } from "./agent/stateweaveAgent.js";
import { createModelFromEnv } from "./llm/factory.js";
import { mockTools } from "./tools/mockTools.js";

const agent = new StateWeaveAgent({ model: createModelFromEnv(), tools: mockTools, maxIterations: 5, traceDir: path.resolve("src/traces") });
const result = await agent.run("Find why login fails after token refresh. Login fails after refresh. Do not rewrite the auth system.");

console.log("Final answer:\n", result.finalAnswer);
console.log("\nGraph nodes:", result.graph.nodes.length);
console.log("Trace steps:", result.trace.length);
