import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtimeDirectories = new Set(["agent", "core", "llm", "tools"]);
const runtimeEntries = new Set(["index", "cli"]);
const extension = /(?:\.d\.ts(?:\.map)?|\.js(?:\.map)?)$/;

function isRuntimeArtifact(file) {
  if (!file.startsWith("dist/") || !extension.test(file)) return false;
  const modulePath = file.slice("dist/".length).replace(extension, "");
  const parts = modulePath.split("/");
  const allowed = parts.length === 1
    ? runtimeEntries.has(parts[0])
    : parts.length === 2 && runtimeDirectories.has(parts[0]);
  return allowed && existsSync(path.join(root, "src", `${modulePath}.ts`));
}

function walk(directory, prefix = "dist") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return walk(path.join(directory, entry.name), relative);
    if (!entry.isFile()) throw new Error(`Unexpected non-file build artifact: ${relative}`);
    return [relative];
  });
}

const stale = walk(path.join(root, "dist")).filter((file) => !isRuntimeArtifact(file));
if (stale.length) throw new Error(`Non-runtime or stale build artifacts: ${stale.join(", ")}. Run a clean build.`);

const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
const pack = JSON.parse(raw)[0];
if (!pack || !Array.isArray(pack.files)) throw new Error("npm pack did not return a file manifest.");

const paths = pack.files.map((file) => file.path);
const metadata = new Set(["package.json", "README.md", "LICENSE"]);
const forbidden = paths.filter((file) => !metadata.has(file) && !isRuntimeArtifact(file));
if (forbidden.length) throw new Error(`Package contains non-runtime artifacts: ${forbidden.join(", ")}`);

const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const entry = manifest.exports?.["."];
assert.equal(typeof entry?.import, "string", "Package must expose an ESM runtime entry");
assert.equal(typeof entry?.types, "string", "Package must expose TypeScript declarations");
const required = [manifest.main, manifest.types, entry.import, entry.types, ...Object.values(manifest.bin ?? {})]
  .map((file) => file.replace(/^\.\//, ""));
const missing = required.filter((file) => !paths.includes(file));
if (missing.length) throw new Error(`Package is missing public artifacts: ${missing.join(", ")}`);

const sdk = await import("stateweave");
for (const name of ["Agent", "MockModel", "createModelFromEnv", "createInitialGraphFrame", "serializeGraphFrame", "parseAndValidateOps", "applyOps"]) {
  assert.equal(typeof sdk[name], "function", `Public export ${name} must load`);
}
const before = sdk.createInitialGraphFrame({ objective: "Package smoke check", availableActions: [] });
const snapshot = structuredClone(before);
const after = sdk.applyOps(before, sdk.parseAndValidateOps('SWX/1\n@final "Package entry works."'));
assert.deepEqual(before, snapshot, "Primitive application must preserve its input");
assert.ok(after.graph.nodes.some((node) => node.type === "assistant_output" && node.text === "Package entry works."));
console.log(`Package manifest and exports verified: ${paths.length} files, ${pack.unpackedSize} unpacked bytes.`);
