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
const defaultReadLimit = 500;

const readFileSchema = z.object({
  file_path: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  startLine: z.coerce.number().int().min(1).optional(),
  maxLines: z.coerce.number().int().min(1).max(2000).optional()
}).superRefine(requireFilePath);

const writeFileSchema = z.object({
  file_path: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  content: z.string()
}).superRefine(requireFilePath);

const booleanArgSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean()).optional();

const editFileSchema = z.object({
  file_path: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  old_string: z.string().optional(),
  oldText: z.string().optional(),
  new_string: z.string().optional(),
  newText: z.string().optional(),
  replace_all: booleanArgSchema,
  replaceAll: booleanArgSchema
}).superRefine((args, context) => {
  requireFilePath(args, context);
  if (args.old_string === undefined && args.oldText === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "old_string is required" });
  if (args.new_string === undefined && args.newText === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "new_string is required" });
});

const bashCommandSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.coerce.number().int().min(100).max(60_000).optional(),
  timeout_ms: z.coerce.number().int().min(100).max(60_000).optional()
});

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
      description: `Read a UTF-8 text file from the agent workspace (${rootDir}). Args: file_path, optional offset (0-indexed line), limit. Alias: path/startLine/maxLines.`,
      schema: readFileSchema,
      async execute(args: unknown) {
        const parsed = normalizeReadFileArgs(args);
        const filePath = resolveWorkspacePath(rootDir, parsed.filePath);
        const content = await readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/);
        const limited = lines.slice(parsed.offset, parsed.offset + parsed.limit).join("\n");
        return { path: parsed.filePath, file_path: parsed.filePath, offset: parsed.offset, limit: parsed.limit, content: limited };
      }
    },
    {
      name: "write_file",
      description: `Create or overwrite a UTF-8 text file inside the agent workspace (${rootDir}). Args: file_path, content. For multiline/SVG/HTML/code content in SWX, use content_ref=<block_id>. Alias: path.`,
      schema: writeFileSchema,
      async execute(args: unknown) {
        const parsed = normalizeWriteFileArgs(args);
        const filePath = resolveWorkspacePath(rootDir, parsed.filePath);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, parsed.content, "utf8");
        return { path: parsed.filePath, file_path: parsed.filePath, bytes: Buffer.byteLength(parsed.content), ok: true };
      }
    },
    {
      name: "edit_file",
      description: `Edit one UTF-8 text file inside the agent workspace (${rootDir}) by exact replacement. Args: file_path, old_string, new_string, optional replace_all. old_string must match exactly and be unique unless replace_all=true. For multiline edits in SWX, use old_string_ref/new_string_ref blocks. Aliases: path/oldText/newText/replaceAll.`,
      schema: editFileSchema,
      async execute(args: unknown) {
        const parsed = normalizeEditFileArgs(args);
        const filePath = resolveWorkspacePath(rootDir, parsed.filePath);
        const content = await readFile(filePath, "utf8");
        const replacement = replaceExact(content, parsed.oldString, parsed.newString, parsed.replaceAll);
        if (typeof replacement === "string") throw new Error(replacement);
        await writeFile(filePath, replacement.content, "utf8");
        return { path: parsed.filePath, file_path: parsed.filePath, replacements: replacement.occurrences, occurrences: replacement.occurrences, ok: true };
      }
    },
    {
      name: "bash_command",
      description: `Run a bash command in the agent workspace (${rootDir}) with a timeout and restricted environment. Args: command, optional timeout_ms. Alias: timeoutMs.`,
      schema: bashCommandSchema,
      async execute(args: unknown) {
        const parsed = normalizeBashCommandArgs(args);
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

function requireFilePath(args: { file_path?: string; path?: string }, context: z.RefinementCtx): void {
  if (!args.file_path && !args.path) context.addIssue({ code: z.ZodIssueCode.custom, message: "file_path is required" });
}

function normalizeReadFileArgs(args: unknown): { filePath: string; offset: number; limit: number } {
  const parsed = readFileSchema.parse(args);
  const offset = parsed.offset ?? (parsed.startLine ? parsed.startLine - 1 : 0);
  return { filePath: filePathFrom(parsed), offset, limit: parsed.limit ?? parsed.maxLines ?? defaultReadLimit };
}

function normalizeWriteFileArgs(args: unknown): { filePath: string; content: string } {
  const parsed = writeFileSchema.parse(args);
  return { filePath: filePathFrom(parsed), content: parsed.content };
}

function normalizeEditFileArgs(args: unknown): { filePath: string; oldString: string; newString: string; replaceAll: boolean } {
  const parsed = editFileSchema.parse(args);
  return {
    filePath: filePathFrom(parsed),
    oldString: parsed.old_string ?? parsed.oldText ?? "",
    newString: parsed.new_string ?? parsed.newText ?? "",
    replaceAll: parsed.replace_all ?? parsed.replaceAll ?? false
  };
}

function normalizeBashCommandArgs(args: unknown): { command: string; timeoutMs?: number } {
  const parsed = bashCommandSchema.parse(args);
  return { command: parsed.command, timeoutMs: parsed.timeout_ms ?? parsed.timeoutMs };
}

function filePathFrom(args: { file_path?: string; path?: string }): string {
  const filePath = args.file_path ?? args.path;
  if (!filePath) throw new Error("file_path is required.");
  return filePath;
}

function replaceExact(content: string, oldString: string, newString: string, replaceAll: boolean): { content: string; occurrences: number } | string {
  if (content === "" && oldString === "") return { content: newString, occurrences: 0 };
  if (oldString === "") return "old_string cannot be empty when file has content";
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) return `old_string was not found in file: ${oldString}`;
  if (occurrences > 1 && !replaceAll) return `old_string appears ${occurrences} times. Use replace_all=true or provide a more specific old_string with surrounding context.`;
  return { content: replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString), occurrences: replaceAll ? occurrences : 1 };
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
