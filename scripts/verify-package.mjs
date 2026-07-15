import { execFileSync } from "node:child_process";

const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });
const pack = JSON.parse(raw)[0];
if (!pack || !Array.isArray(pack.files)) throw new Error("npm pack did not return a file manifest.");

const paths = pack.files.map((file) => file.path);
const forbidden = paths.filter((file) =>
  file.startsWith("dist/evals/")
  || file.startsWith("dist/web/")
  || file.startsWith("data/")
  || file.includes("challenger-scenarios")
  || file.includes("traces/")
);
const required = ["dist/index.js", "dist/index.d.ts", "dist/agent/stateweaveAgent.js", "dist/core/graph.js"];
const missing = required.filter((file) => !paths.includes(file));

if (forbidden.length) throw new Error(`Package contains private/non-SDK artifacts: ${forbidden.join(", ")}`);
if (missing.length) throw new Error(`Package is missing public SDK artifacts: ${missing.join(", ")}`);
console.log(`Package manifest verified: ${paths.length} files, ${pack.unpackedSize} unpacked bytes.`);
