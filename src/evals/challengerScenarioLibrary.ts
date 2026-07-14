import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type ChallengerScenarioSummary = {
  id: string;
  filename: string;
  title: string;
  tldr: string;
  domain: string;
  estimatedTurns: number;
  status: string;
};

export type ChallengerScenario = ChallengerScenarioSummary & { markdown: string };

const scenarioFilename = /^[a-z0-9][a-z0-9-]*\.md$/;

export async function listChallengerScenarios(rootDir: string): Promise<ChallengerScenarioSummary[]> {
  const names = (await readdir(rootDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && scenarioFilename.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map(async (filename) => parseScenario(filename, await readFile(path.join(rootDir, filename), "utf8"))));
}

export async function readChallengerScenario(rootDir: string, filename: string): Promise<ChallengerScenario | undefined> {
  if (!scenarioFilename.test(filename)) return undefined;
  try {
    return parseScenario(filename, await readFile(path.join(rootDir, filename), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function parseScenario(filename: string, source: string): ChallengerScenario {
  const normalized = source.replace(/\r\n?/g, "\n");
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatter) throw new Error(`Challenger scenario ${filename} is missing frontmatter.`);
  const fields = new Map<string, string>();
  for (const line of frontmatter[1].split("\n")) {
    const field = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (field) fields.set(field[1], unquote(field[2]));
  }
  const required = (name: string): string => {
    const value = fields.get(name)?.trim();
    if (!value) throw new Error(`Challenger scenario ${filename} is missing ${name}.`);
    return value;
  };
  const estimatedTurns = Number(required("estimated_turns"));
  if (!Number.isInteger(estimatedTurns) || estimatedTurns < 1) throw new Error(`Challenger scenario ${filename} has invalid estimated_turns.`);
  return {
    id: required("id"),
    filename,
    title: required("title"),
    tldr: required("tldr"),
    domain: required("domain"),
    estimatedTurns,
    status: required("status"),
    markdown: normalized.slice(frontmatter[0].length).trim()
  };
}

function unquote(value: string): string {
  const quote = value[0];
  return quote && (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value;
}
