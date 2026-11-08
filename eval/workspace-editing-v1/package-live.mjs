import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
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

const zodPackagePath = require.resolve("zod/package.json");
const zodPackage = JSON.parse(await readFile(zodPackagePath, "utf8"));
const zodSource = path.dirname(zodPackagePath);
const zodTarget = path.join(output, "node_modules/zod");
await cp(zodSource, zodTarget, { recursive: true, dereference: true });

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
  resources: receiptFiles,
  bundledDependencies: {
    zod: { version: zodPackage.version, treeSha256: await hashTree(zodTarget) }
  }
};
await writeFile(path.join(output, "PACKAGE-RECEIPT.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`Live executor package verified at ${output} (${resources.size} frozen resources).`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashTree(rootDirectory) {
  const hash = createHash("sha256");
  await visit(rootDirectory, "", hash);
  return hash.digest("hex");
}

async function visit(rootDirectory, relative, hash) {
  const directory = path.join(rootDirectory, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) await visit(rootDirectory, childRelative, hash);
    else if (entry.isFile()) {
      hash.update(childRelative.replaceAll(path.sep, "/"));
      hash.update("\0");
      hash.update(await readFile(path.join(rootDirectory, childRelative)));
      hash.update("\0");
    } else {
      throw new Error(`Bundled dependency contains unsupported entry: ${childRelative}`);
    }
  }
}
