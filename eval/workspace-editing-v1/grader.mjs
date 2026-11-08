import { isDeepStrictEqual } from "node:util";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const spec = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"));
const cases = new Map(spec.cases.map((item) => [item.id, item]));

export function getWorkspaceEditingCases() {
  return structuredClone(spec);
}

export async function gradeWorkspaceEditingCase({ caseId, workspaceDir, finalAnswer = "" }) {
  const item = cases.get(caseId);
  if (!item) throw new Error(`Unknown workspace-editing case: ${caseId}`);

  const failures = [];
  const actualFiles = await listWorkspaceFiles(workspaceDir, failures);
  const expectedPaths = Object.keys(item.expectedFiles).sort();
  const fileScope = isDeepStrictEqual(actualFiles, expectedPaths);
  if (!fileScope) failures.push(`file scope mismatch: expected ${expectedPaths.join(", ")}; found ${actualFiles.join(", ")}`);

  const contents = await readWorkspaceFiles(workspaceDir, actualFiles);
  const readOnlyUnchanged = checkReadOnlyFiles(item, contents, failures);
  const artifactSafety = checkArtifactSafety(contents, failures);
  const workspaceFailures = gradeWorkspace(caseId, item, contents);
  failures.push(...workspaceFailures);
  const workspaceCorrect = workspaceFailures.length === 0;
  const answerCorrect = gradeFinalAnswer(item, finalAnswer, failures);

  const taskOutcome = fileScope && readOnlyUnchanged && artifactSafety && workspaceCorrect && answerCorrect !== false;
  return {
    caseId,
    grade: { taskOutcome, workspaceCorrect, answerCorrect, fileScope, readOnlyUnchanged, artifactSafety },
    failures
  };
}

async function readWorkspaceFiles(workspaceDir, relativePaths) {
  const contents = {};
  for (const relativePath of relativePaths) {
    try {
      contents[relativePath] = await readFile(path.join(workspaceDir, relativePath), "utf8");
    } catch (error) {
      throw new Error(`grader cannot read ${relativePath}: ${errorMessage(error)}`);
    }
  }
  return contents;
}

function checkReadOnlyFiles(item, contents, failures) {
  let unchanged = true;
  for (const [relativePath, initial] of Object.entries(item.initialFiles)) {
    if (item.editable.includes(relativePath) || contents[relativePath] === initial) continue;
    unchanged = false;
    failures.push(`read-only file changed: ${relativePath}`);
  }
  return unchanged;
}

function checkArtifactSafety(contents, failures) {
  let safe = true;
  for (const [relativePath, content] of Object.entries(contents)) {
    const safetyFailure = relativePath.endsWith(".svg") ? unsafeSvgReason(content) : undefined;
    if (!safetyFailure) continue;
    safe = false;
    failures.push(`${relativePath} is unsafe: ${safetyFailure}`);
  }
  return safe;
}

function gradeWorkspace(caseId, item, contents) {
  const failures = [];
  switch (caseId) {
    case "SDKWS-01":
      gradePanelSvg(contents["assets/panel.svg"], failures);
      break;
    case "SDKWS-02":
    case "SDKWS-04":
      gradeJsonFile(item, contents, Object.keys(item.expectedFiles).find((name) => item.editable.includes(name)), failures);
      break;
    case "SDKWS-03":
      if (contents["settings/manual.json"] !== item.expectedFiles["settings/manual.json"]) failures.push("settings/manual.json must remain byte-for-byte unchanged");
      break;
    case "SDKWS-05":
      gradeJsonFile(item, contents, "assets/catalog.json", failures);
      gradeJsonFile(item, contents, "docs/preview.json", failures);
      break;
    default:
      throw new Error(`No grader for ${caseId}`);
  }
  return failures;
}

/** null when the case has no required answer; otherwise whether the answer is the exact required JSON object. */
function gradeFinalAnswer(item, finalAnswer, failures) {
  if (item.expectedFinalAnswer === undefined) return null;
  try {
    const correct = isDeepStrictEqual(parseJsonNoDuplicateKeys(finalAnswer), item.expectedFinalAnswer);
    if (!correct) failures.push("final answer JSON does not equal the required object");
    return correct;
  } catch (error) {
    failures.push(`final answer is not one strict JSON object: ${errorMessage(error)}`);
    return false;
  }
}

function gradeJsonFile(item, contents, relativePath, failures) {
  if (!relativePath || !(relativePath in item.expectedFiles)) {
    failures.push("grader configuration missing editable JSON path");
    return;
  }
  const actualText = contents[relativePath];
  if (actualText === undefined) {
    failures.push(`missing ${relativePath}`);
    return;
  }
  let expected;
  try {
    expected = parseJsonNoDuplicateKeys(item.expectedFiles[relativePath]);
  } catch (error) {
    throw new Error(`grader expected state for ${relativePath} is invalid: ${errorMessage(error)}`);
  }
  try {
    const actual = parseJsonNoDuplicateKeys(actualText);
    if (!isDeepStrictEqual(actual, expected)) failures.push(`${relativePath} has the wrong JSON value`);
  } catch (error) {
    failures.push(`${relativePath} is not strict JSON: ${errorMessage(error)}`);
  }
}

function gradePanelSvg(text, failures) {
  if (typeof text !== "string") {
    failures.push("missing assets/panel.svg");
    return;
  }
  const match = text.match(/^\s*<svg\b([^>]*)>\s*<rect\b([^>]*)\/>\s*<rect\b([^>]*)\/>\s*<text\b([^>]*)>([\s\S]*?)<\/text>\s*<\/svg>\s*$/i);
  if (!match) {
    failures.push("panel SVG must retain one svg root with rect, rect, text children in the original order");
    return;
  }
  try {
    const root = parseXmlAttributes(match[1]);
    const background = parseXmlAttributes(match[2]);
    const indicator = parseXmlAttributes(match[3]);
    const caption = parseXmlAttributes(match[4]);
    assertExactKeys(root, ["xmlns", "viewBox"], "svg root");
    assertExactKeys(background, ["id", "x", "y", "width", "height", "fill"], "background");
    assertExactKeys(indicator, ["id", "x", "y", "width", "height", "fill"], "indicator");
    assertExactKeys(caption, ["id", "x", "y", "fill"], "caption");
    if (root.xmlns !== "http://www.w3.org/2000/svg") throw new Error("wrong SVG namespace");
    assertNumbers(root.viewBox, [0, 0, 160, 80], "viewBox");
    assertElement(background, { id: "background", x: 0, y: 0, width: 160, height: 80, fill: "#ffffff" });
    assertElement(indicator, { id: "indicator", x: 16, y: 34, width: 36, height: 12, fill: "#0f766e" });
    assertElement(caption, { id: "caption", x: 74, y: 43, fill: "#111827" });
    if (decodeXml(match[5].trim()) !== "SDK queued") throw new Error("caption text must be SDK queued");
  } catch (error) {
    failures.push(`assets/panel.svg: ${errorMessage(error)}`);
  }
}

function assertElement(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "number") {
      if (Number(actual[key]) !== value) throw new Error(`${expected.id} ${key} must be ${value}`);
    } else if (actual[key] !== value) {
      throw new Error(`${expected.id} ${key} must be ${value}`);
    }
  }
}

function assertNumbers(text, expected, label) {
  const actual = String(text).trim().split(/[\s,]+/).map(Number);
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${label} must be ${expected.join(" ")}`);
}

function assertExactKeys(record, expected, label) {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) throw new Error(`${label} attributes must be exactly ${wanted.join(", ")}`);
}

function parseXmlAttributes(text) {
  const result = {};
  let offset = 0;
  const pattern = /\s*([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("[^"]*"|'[^']*')/gy;
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) {
      if (/^\s*$/.test(text.slice(offset))) break;
      throw new Error(`invalid XML attributes near ${JSON.stringify(text.slice(offset, offset + 30))}`);
    }
    const key = match[1];
    if (key in result) throw new Error(`duplicate XML attribute ${key}`);
    result[key] = decodeXml(match[2].slice(1, -1));
    offset = pattern.lastIndex;
  }
  return result;
}

function decodeXml(text) {
  return text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (whole, numeric, named) => {
    if (numeric) return String.fromCodePoint(Number.parseInt(numeric.startsWith("x") ? numeric.slice(1) : numeric, numeric.startsWith("x") ? 16 : 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
  });
}

function unsafeSvgReason(text) {
  if (typeof text !== "string") return "missing SVG content";
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return "DOCTYPE/entity declarations are forbidden";
  if (/<\s*(?:script|foreignObject)\b/i.test(text)) return "script and foreignObject elements are forbidden";
  if (/\son[a-z0-9_-]+\s*=/i.test(text)) return "event-handler attributes are forbidden";
  if (/\b(?:href|xlink:href)\s*=|url\s*\(/i.test(text)) return "external references are forbidden";
  return null;
}

async function listWorkspaceFiles(root, failures) {
  const files = [];
  async function visit(relative) {
    let entries;
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch (error) {
      throw new Error(`grader cannot enumerate workspace: ${errorMessage(error)}`);
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
      const absolute = path.join(root, child);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        failures.push(`symbolic link is not allowed: ${child}`);
      } else if (stat.isDirectory()) {
        await visit(child);
      } else if (stat.isFile()) {
        files.push(child);
      } else {
        failures.push(`non-regular workspace entry is not allowed: ${child}`);
      }
    }
  }
  await visit("");
  return files.sort();
}

function parseJsonNoDuplicateKeys(text) {
  return new StrictJsonParser(String(text)).parseDocument();
}

/** A JSON parser that rejects duplicate object keys, which JSON.parse silently collapses. */
class StrictJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parseDocument() {
    const value = this.parseValue();
    this.whitespace();
    if (this.index !== this.source.length) this.fail("trailing content");
    return value;
  }

  whitespace() {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }

  fail(message) {
    throw new Error(`${message} at character ${this.index}`);
  }

  parseValue() {
    this.whitespace();
    const char = this.source[this.index];
    if (char === '"') return this.parseString();
    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    return this.parseLiteral();
  }

  parseString() {
    const { source } = this;
    if (source[this.index] !== '"') this.fail("expected JSON string");
    const start = this.index++;
    while (this.index < source.length) {
      const char = source[this.index++];
      if (char === '"') return JSON.parse(source.slice(start, this.index));
      if (char === "\\") this.index += 1;
      else if (char.charCodeAt(0) < 0x20) this.fail("unescaped control character");
    }
    this.fail("unterminated JSON string");
  }

  parseObject() {
    this.index += 1;
    this.whitespace();
    const value = {};
    const keys = new Set();
    if (this.source[this.index] === "}") { this.index += 1; return value; }
    while (true) {
      this.whitespace();
      const key = this.parseString();
      if (keys.has(key)) this.fail(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.whitespace();
      if (this.source[this.index++] !== ":") this.fail("expected colon");
      Object.defineProperty(value, key, { value: this.parseValue(), enumerable: true, configurable: true, writable: true });
      this.whitespace();
      const separator = this.source[this.index++];
      if (separator === "}") return value;
      if (separator !== ",") this.fail("expected comma or closing brace");
    }
  }

  parseArray() {
    this.index += 1;
    this.whitespace();
    const value = [];
    if (this.source[this.index] === "]") { this.index += 1; return value; }
    while (true) {
      value.push(this.parseValue());
      this.whitespace();
      const separator = this.source[this.index++];
      if (separator === "]") return value;
      if (separator !== ",") this.fail("expected comma or closing bracket");
    }
  }

  parseLiteral() {
    for (const [token, value] of [["true", true], ["false", false], ["null", null]]) {
      if (this.source.startsWith(token, this.index)) { this.index += token.length; return value; }
    }
    const number = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) { this.index += number[0].length; return Number(number[0]); }
    this.fail("unexpected JSON token");
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
