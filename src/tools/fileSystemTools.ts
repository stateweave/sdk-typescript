import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool } from "./types.js";

const execFileAsync = promisify(execFile);

export type BuiltInToolInfo = { name: string; description: string };
export type FileSystemToolsOptions = {
  rootDir?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

const defaultTimeoutMs = 10_000;
const defaultMaxOutputBytes = 64_000;

export function createDefaultTools(options: FileSystemToolsOptions = {}): Tool[] {
  return createFileSystemTools(options);
}

export function createFileSystemTools(options: FileSystemToolsOptions = {}): Tool[] {
  const rootDir = path.resolve(options.rootDir ?? process.env.STATEWEAVE_WORKSPACE_DIR ?? path.join(process.cwd(), ".stateweave", "workspace"));
  const timeoutMs = options.timeoutMs ?? numberEnv(process.env.STATEWEAVE_TOOL_TIMEOUT_MS) ?? defaultTimeoutMs;
  const maxOutputBytes = options.maxOutputBytes ?? numberEnv(process.env.STATEWEAVE_TOOL_MAX_OUTPUT_BYTES) ?? defaultMaxOutputBytes;

  return [
    {
      name: "read_file",
      description: `Read a UTF-8 text file from the agent workspace (${rootDir}). Args: path, optional startLine, maxLines.`,
      schema: z.object({ path: z.string().min(1), startLine: z.number().int().min(1).optional(), maxLines: z.number().int().min(1).max(2000).optional() }),
      async execute(args: unknown) {
        const parsed = z.object({ path: z.string().min(1), startLine: z.number().int().min(1).optional(), maxLines: z.number().int().min(1).max(2000).optional() }).parse(args);
        const filePath = resolveWorkspacePath(rootDir, parsed.path);
        const content = await readFile(filePath, "utf8");
        if (!parsed.startLine && !parsed.maxLines) return { path: parsed.path, content };
        const lines = content.split(/\r?\n/);
        const start = parsed.startLine ?? 1;
        const max = parsed.maxLines ?? 200;
        return { path: parsed.path, startLine: start, content: lines.slice(start - 1, start - 1 + max).join("\n") };
      }
    },
    {
      name: "write_file",
      description: `Create or overwrite a UTF-8 text file inside the agent workspace (${rootDir}). Args: path, content.`,
      schema: z.object({ path: z.string().min(1), content: z.string() }),
      async execute(args: unknown) {
        const parsed = z.object({ path: z.string().min(1), content: z.string() }).parse(args);
        const filePath = resolveWorkspacePath(rootDir, parsed.path);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, parsed.content, "utf8");
        return { path: parsed.path, bytes: Buffer.byteLength(parsed.content), ok: true };
      }
    },
    {
      name: "edit_file",
      description: `Edit one UTF-8 text file inside the agent workspace (${rootDir}) by exact replacement. Args: path, oldText, newText.`,
      schema: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }),
      async execute(args: unknown) {
        const parsed = z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }).parse(args);
        const filePath = resolveWorkspacePath(rootDir, parsed.path);
        const content = await readFile(filePath, "utf8");
        const first = content.indexOf(parsed.oldText);
        if (first === -1) throw new Error(`edit_file could not find oldText in ${parsed.path}`);
        if (content.indexOf(parsed.oldText, first + parsed.oldText.length) !== -1) throw new Error(`edit_file oldText is not unique in ${parsed.path}`);
        const next = content.slice(0, first) + parsed.newText + content.slice(first + parsed.oldText.length);
        await writeFile(filePath, next, "utf8");
        return { path: parsed.path, replacements: 1, ok: true };
      }
    },
    {
      name: "bash_command",
      description: `Run a bash command in the agent workspace (${rootDir}) with a timeout and restricted environment. Args: command, optional timeoutMs.`,
      schema: z.object({ command: z.string().min(1), timeoutMs: z.number().int().min(100).max(60_000).optional() }),
      async execute(args: unknown) {
        const parsed = z.object({ command: z.string().min(1), timeoutMs: z.number().int().min(100).max(60_000).optional() }).parse(args);
        await mkdir(rootDir, { recursive: true });
        try {
          const result = await execFileAsync("bash", ["-lc", parsed.command], {
            cwd: rootDir,
            env: safeToolEnv(rootDir),
            timeout: Math.min(parsed.timeoutMs ?? timeoutMs, 60_000),
            maxBuffer: maxOutputBytes
          });
          return { exitCode: 0, stdout: truncate(result.stdout, maxOutputBytes), stderr: truncate(result.stderr, maxOutputBytes) };
        } catch (error) {
          const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string; signal?: string };
          return {
            exitCode: typeof failure.code === "number" ? failure.code : 1,
            signal: failure.signal,
            stdout: truncate(failure.stdout ?? "", maxOutputBytes),
            stderr: truncate(failure.stderr ?? failure.message, maxOutputBytes)
          };
        }
      }
    }
  ];
}

export function describeTools(tools: Tool[]): BuiltInToolInfo[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description }));
}

function resolveWorkspacePath(rootDir: string, requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) throw new Error("File tool paths must be relative to the agent workspace.");
  const resolved = path.resolve(rootDir, requestedPath);
  if (resolved !== rootDir && !resolved.startsWith(`${rootDir}${path.sep}`)) throw new Error(`Path escapes the agent workspace: ${requestedPath}`);
  return resolved;
}

function safeToolEnv(rootDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: rootDir,
    LANG: "C.UTF-8"
  };
}

function numberEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function truncate(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n...[truncated to ${maxBytes} bytes]`;
}
