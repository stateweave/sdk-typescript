// Run-level evidence gates: what the task asked for, what tools proved, and what a final answer may claim.
import { activeFileState, unique } from "../core/graphEdit.js";
import type { GraphOp, StateGraph } from "../core/types.js";

export type Intent = { mutation: boolean; verification: boolean; check: boolean; restart: boolean; smoke: boolean };

export type ToolSignals = { mutation: boolean; inspection: boolean; verification: boolean; check: boolean; restart: boolean; smoke: boolean; mutatedPaths: string[] };

export type Evidence = Omit<ToolSignals, "mutatedPaths"> & { mutatedPaths: Set<string>; lastMutationStep: number };

type CallTool = Extract<GraphOp, { op: "call_tool" }>;

export function detectIntent(text: string): Intent {
  const mutation = /\b(create|write|edit|change|update|set|increase|decrease|fix|implement|remove|replace|modify)\b/i.test(text)
    && /\b(file|workspace|manifest|module|source|document)|(?:^|\s)[a-z0-9_./-]+\.(?:js|ts|json|md|txt|html|css|svg)\b/i.test(text);
  const withoutSmoke = text.replace(/smoke[- ]?(?:check|test)/gi, "");
  return {
    mutation,
    verification: /\b(verify|verification|run\s+[^.\n]*(?:check|test)|node\s+--check|test(?:s|ing)?|check|smoke|restart)\b/i.test(text),
    check: /\b(?:run|running|execute)[^.\n]*(?:checks?|tests?)\b|\b(?:syntax|project|regression|unit|integration)\s*(?:\/|and\s+)?\s*(?:checks?|tests?)\b|\btests?\b|node\s+--check|app_control\s+action=check/i.test(withoutSmoke),
    restart: /\brestart(?:ed|ing)?\b/i.test(text),
    smoke: /\bsmoke(?:[- ]?(?:check|test))(?:ed|ing)?\b|\bsmoke-check\b/i.test(text)
  };
}

export function newEvidence(): Evidence {
  return { mutation: false, inspection: false, verification: false, check: false, restart: false, smoke: false, mutatedPaths: new Set(), lastMutationStep: 0 };
}

/** A new mutation invalidates earlier verification; everything else accumulates. */
export function recordSignals(evidence: Evidence, signals: ToolSignals, step: number): void {
  if (signals.mutation) Object.assign(evidence, { mutation: true, lastMutationStep: step, verification: false, check: false, restart: false, smoke: false });
  for (const key of ["inspection", "verification", "check", "restart", "smoke"] as const) evidence[key] ||= signals[key];
  for (const path of signals.mutatedPaths) evidence.mutatedPaths.add(path);
}

export function signalsFor(op: CallTool, result: unknown): ToolSignals {
  const action = op.tool === "app_control" && typeof op.args.action === "string" ? op.args.action : undefined;
  const mutatedPaths = toolMutationPaths(op.tool, op.args, result);
  return {
    mutation: mutatedPaths.length > 0,
    inspection: op.tool === "read_file",
    verification: op.tool === "read_file" || op.tool === "bash_command" || op.tool === "app_control",
    check: op.tool === "bash_command" || action === "check",
    restart: action === "restart",
    smoke: action === "smoke" || action === "restart",
    mutatedPaths
  };
}

export function validateToolTransaction(ops: GraphOp[]): void {
  const calls = ops.filter((op) => op.op === "call_tool").length;
  if (ops.some((op) => op.op === "spawn_worker") && ops.some((op) => op.op === "final")) {
    throw new Error("A transaction cannot spawn workers and finalize; spawn workers first, then F after their results merge.");
  }
  if (calls && (calls > 1 || ops.some((op) => op.op === "final" || op.op === "spawn_worker"))) {
    throw new Error("One T per transaction, without F: call exactly one tool, read its tool_result, then continue.");
  }
}

/**
 * edit_file needs evidence of the file's current content: a hash the model passes explicitly, or an
 * active canonical file-state node in the graph (written by read/write/edit results in any earlier turn).
 */
export function validateEditEvidence(ops: GraphOp[], graph: StateGraph): void {
  const edit = ops.find((op): op is CallTool => op.op === "call_tool" && op.tool === "edit_file");
  if (!edit) return;
  const path = toolPath(edit.args);
  const hash = edit.args.expected_hash ?? edit.args.expectedHash;
  if (!path || typeof hash === "string" || activeFileState(graph, path)) return;
  throw new Error(`edit_file ${path} needs current evidence: T read_file path=${path} first, or pass expected_hash=<content_hash>.`);
}

export function validateFinalEvidence(ops: GraphOp[], intent: Intent, evidence: Evidence): void {
  const final = ops.find((op): op is Extract<GraphOp, { op: "final" }> => op.op === "final");
  if (!final) return;
  const failure = finalEvidenceFailure(final, intent, evidence);
  if (failure) throw new Error(failure);
}

function finalEvidenceFailure(final: Extract<GraphOp, { op: "final" }>, intent: Intent, evidence: Evidence): string | undefined {
  const satisfied = final.outcome === "already_satisfied";
  if (intent.mutation && !evidence.mutation && !satisfied) return "Final answer requires workspace mutation evidence. If inspection proves the requested state already exists, verify it and use outcome=already_satisfied; otherwise perform the mutation first.";
  if (intent.mutation && !evidence.mutation && !evidence.inspection) return "outcome=already_satisfied requires successful read_file evidence from this run.";
  const claimed = satisfied || !/\b(created|wrote|updated|edited|changed|fixed|implemented|removed|replaced)\b/i.test(final.answer) ? [] : workspacePaths(final.answer).filter((path) => !evidence.mutatedPaths.has(path));
  if (claimed.length) return `Final answer claims changes to ${claimed.join(", ")}, but this run has no successful mutation evidence for those paths.`;
  if (intent.check && !evidence.check) return "The task explicitly requests checks/tests, but no successful bash_command or app_control action=check result exists. Run the check before finalizing.";
  if (intent.restart && !evidence.restart) return "The task explicitly requests a restart, but no successful app_control action=restart result exists. Restart before finalizing.";
  if (intent.smoke && !evidence.smoke) return "The task explicitly requests a smoke check, but no successful app_control action=smoke or action=restart result exists. Smoke-check before finalizing.";
  if (intent.verification && evidence.mutation && !evidence.verification) return "The task explicitly requests verification, but no successful post-mutation read_file, bash_command, or app_control result exists. Verify before finalizing.";
  return undefined;
}

export function toolExecutionSucceeded(tool: string, result: unknown): boolean {
  const record = asRecord(result);
  if (tool === "bash_command") return record?.exitCode === 0;
  if (tool !== "app_control") return record?.ok !== false;
  if (!record) return false;
  if (typeof record.ok === "boolean") return record.ok;
  if (typeof record.healthy === "boolean" || typeof record.pageOk === "boolean") return record.healthy === true && record.pageOk === true;
  return record.running === true;
}

export function toolFailureMessage(tool: string, result: unknown): string {
  const record = asRecord(result);
  if (!record) return `${tool} reported an unsuccessful result.`;
  if (typeof record.error === "string") return record.error;
  const frontend = asRecord(record.frontend);
  const missing = Array.isArray(frontend?.missingElementIds) ? frontend.missingElementIds.join(", ") : "";
  const unstyled = Array.isArray(frontend?.unstyledClasses) ? frontend.unstyledClasses.join(", ") : "";
  if (missing || unstyled) return `frontend coherence failed${missing ? `; missing element ids: ${missing}` : ""}${unstyled ? `; unstyled classes: ${unstyled}` : ""}`;
  const details = asRecord(record.acceptance)?.details;
  if (Array.isArray(details)) return `acceptance checks failed: ${details.map(String).join(", ")}`;
  return `${tool} reported an unsuccessful result: ${JSON.stringify(result).slice(0, 1200)}`;
}

export function safeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(["file_path", "path", "command", "expected_hash", "expectedHash"].filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
}

function toolMutationPaths(tool: string, args: Record<string, unknown>, result: unknown): string[] {
  if (tool === "write_file" || tool === "edit_file") {
    const path = toolPath(args);
    return path && isMeaningfulMutationPath(path) ? [path] : [];
  }
  const paths = asRecord(result)?.mutated_paths;
  return Array.isArray(paths) ? paths.filter((value): value is string => typeof value === "string" && value.length > 0 && isMeaningfulMutationPath(value)).slice(0, 1_000) : [];
}

const generatedDirectories = new Set(["node_modules", ".home", ".npm-cache", ".cache", ".vite", "dist", "build", "coverage", "logs", "tmp"]);

function isMeaningfulMutationPath(filePath: string): boolean {
  const segments = filePath.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.some((segment) => generatedDirectories.has(segment))) return false;
  const name = segments.at(-1) ?? filePath;
  return !/(?:\.log|\.pid|\.tmp|\.cache|\.tsbuildinfo)$/i.test(name) && !/^(?:test|vitest|build|npm)[-_].*\.(?:log|txt|json)$/i.test(name);
}

function toolPath(args: Record<string, unknown>): string | undefined {
  if (typeof args.file_path === "string") return args.file_path;
  return typeof args.path === "string" ? args.path : undefined;
}

function workspacePaths(text: string): string[] {
  return unique(text.match(/\b(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:js|ts|json|md|txt|html|css|svg)\b/gi) ?? []);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
