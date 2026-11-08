import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const output = path.join(root, ".live-dist");
const manifestPath = path.join(here, "frozen-live-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (dirty) throw new Error(`Refusing to package a dirty live executor:\n${dirty}`);

const resources = new Set([
  ...Object.keys(manifest.files),
  "eval/workspace-editing-v1/frozen-live-manifest.json",
  "eval/workspace-editing-v1/grader.mjs",
  "eval/workspace-editing-v1/cases.json"
]);
for (const relativePath of resources) {
  const source = path.join(root, relativePath);
  const target = path.join(output, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

for (const relativePath of [
  "eval/workspace-editing-v1/run-live.js",
  "eval/workspace-editing-v1/live-provider.js",
  "eval/workspace-editing-v1/runner.js",
  "src/agent/stateweaveRunner.js",
  "src/core/validateOps.js",
  "src/llm/anthropicModel.js",
  "src/tools/fileSystemTools.js"
]) {
  const file = path.join(output, relativePath);
  if (!(await stat(file)).isFile()) throw new Error(`Compiled live package is missing ${relativePath}.`);
}

const receiptFiles = {};
for (const relativePath of [...resources].sort()) {
  receiptFiles[relativePath] = sha256(await readFile(path.join(output, relativePath)));
}
const receipt = {
  schemaVersion: 1,
  sourceRevision,
  manifestSha256: sha256(await readFile(manifestPath)),
  builtAt: new Date().toISOString(),
  resources: receiptFiles
};
await writeFile(path.join(output, "PACKAGE-RECEIPT.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`Live executor package verified at ${output} (${resources.size} frozen resources).`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
