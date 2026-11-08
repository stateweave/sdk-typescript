// What a tool result proves for the causal Agent: resource versions, verification, and meaningful mutations.
import { isMeaningfulMutationPath } from "./runEvidence.js";
import { toolResultSucceeded } from "./toolProtocol.js";

type ResourceChange = { key: string; payload: Record<string, unknown> };

export function resourceChanges(toolName: string, args: unknown, result: unknown): ResourceChange[] {
  const toolArgs = asRecord(args);
  const record = asRecord(result);
  const paths = new Set<string>();
  const direct = record.file_path ?? record.path ?? toolArgs.file_path ?? toolArgs.path;
  if (typeof direct === "string" && direct) paths.add(direct);
  for (const value of Array.isArray(record.mutated_paths) ? record.mutated_paths : []) if (typeof value === "string" && value) paths.add(value);
  return [...paths].map((filePath) => ({
    key: filePath,
    payload: {
      path: filePath,
      operation: toolName,
      ...(typeof record.content_hash === "string" ? { contentHash: record.content_hash } : {}),
      ...(typeof record.bytes === "number" ? { bytes: record.bytes } : {}),
      succeeded: toolResultSucceeded(result)
    }
  }));
}

export function meaningfulMutationPaths(toolName: string, args: unknown, result: unknown): string[] {
  if (!toolResultSucceeded(result)) return [];
  const record = asRecord(result);
  const toolArgs = asRecord(args);
  const values = toolName === "write_file" || toolName === "edit_file"
    ? [toolArgs.file_path ?? toolArgs.path]
    : Array.isArray(record.mutated_paths) ? record.mutated_paths : [];
  return values.filter((value): value is string => typeof value === "string" && isMeaningfulMutationPath(value));
}

/** `mutatedBefore` is the set of paths this run had changed before the tool ran. */
export function verificationRecord(toolName: string, args: unknown, result: unknown, mutatedBefore: Set<string>): Record<string, unknown> | undefined {
  if (!toolResultSucceeded(result)) return undefined;
  const toolArgs = asRecord(args);
  const filePath = String(toolArgs.file_path ?? toolArgs.path ?? "");
  const action = String(toolArgs.action);
  if (toolName === "read_file" && filePath && mutatedBefore.has(filePath) && isMeaningfulMutationPath(filePath)) return { method: "post_mutation_read", path: filePath };
  if (toolName === "bash_command" && /\bnode\s+--check\b/.test(String(toolArgs.command ?? ""))) return { method: "syntax_check", command: String(toolArgs.command) };
  if (toolName === "app_control" && ["check", "restart", "smoke"].includes(action)) return { method: action };
  return asRecord(result).verification === true ? { method: "tool_declared" } : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
