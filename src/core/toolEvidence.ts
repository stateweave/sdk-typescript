// Runtime-derived tool structure: anchor → tool_call → tool_result → file state.
import { forkGraph, nowIso } from "./graph.js";
import { addEdge, isFileNodeFor, uniqueNodeId, workspacePathKey } from "./graphEdit.js";
import type { GraphNode, StateGraph } from "./types.js";

export type ToolResultArgs = { tool: string; toolArgs?: Record<string, unknown>; result: unknown; step: number; ok?: boolean; anchorId?: string };

export function addToolResult(graph: StateGraph, args: ToolResultArgs): StateGraph {
  const next = forkGraph(graph);
  const anchor = anchorNode(next, args.anchorId);
  const callId = uniqueNodeId(next.nodes, `tool_call_${args.step}`);
  const resultId = uniqueNodeId(next.nodes, `tool_result_${args.step}`);
  const createdAt = nowIso();
  const ok = args.ok !== false;
  next.nodes.push(
    { id: callId, type: "tool_call", text: `Called ${args.tool}`, data: { tool: args.tool, args: summarizeToolArgs(args.toolArgs) }, status: ok ? "resolved" : "rejected", createdAt },
    { id: resultId, type: "tool_result", text: toolResultSummary(args.tool, args.result, ok), data: { tool: args.tool, result: args.result, ok }, status: ok ? "active" : "rejected", confidence: 1, createdAt }
  );
  if (anchor) addEdge(next, anchor.id, callId, "relates_to");
  addEdge(next, callId, resultId, ok ? "explains" : "contradicts");
  if (ok) addVersionedFileState(next, resultId, args.result, createdAt);
  return next;
}

/** The explicit anchor, else the latest user input, else the system root, else the first node. */
function anchorNode(graph: StateGraph, anchorId: string | undefined): GraphNode | undefined {
  return (anchorId ? graph.nodes.find((node) => node.id === anchorId) : undefined)
    ?? [...graph.nodes].reverse().find((node) => node.type === "user_input")
    ?? graph.nodes.find((node) => node.id === "system_root")
    ?? graph.nodes[0];
}

function addVersionedFileState(graph: StateGraph, resultId: string, result: unknown, createdAt: string): void {
  const record = asRecord(result);
  const rawPath = resultPath(record);
  const hash = contentHash(record);
  if (!rawPath || !hash) return;
  const filePath = workspacePathKey(rawPath);
  const current = graph.nodes.find((node) => isFileNodeFor(node, filePath) && node.data?.contentHash === hash && node.status === "active");
  if (current) {
    addEdge(graph, resultId, current.id, "validates");
    return;
  }
  for (const node of graph.nodes) {
    if (isFileNodeFor(node, filePath) && node.status === "active") node.status = "stale";
  }
  const id = uniqueNodeId(graph.nodes, `file_state_${filePath}_${hash.slice(0, 10)}`.replace(/[^a-zA-Z0-9_]/g, "_"));
  const node: GraphNode = { id, type: "file", text: `${filePath} current content version ${hash.slice(0, 12)}`, data: { path: filePath, contentHash: hash, canonical: true }, status: "active", confidence: 1, createdAt };
  graph.nodes.push(node);
  addEdge(graph, resultId, id, "validates");
}

function summarizeToolArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  return Object.fromEntries(Object.entries(args).slice(0, 32).map(([key, value]) => [key, summarizeToolArgValue(key, value, 0)]));
}

function summarizeToolArgValue(key: string, value: unknown, depth: number): unknown {
  if (typeof value === "string") return summarizeString(value, stringLimit(key));
  if (value === null || typeof value !== "object") return summarizeScalar(value);
  if (depth >= 2) return Array.isArray(value) ? { items: value.length } : { keys: Object.keys(value).slice(0, 16) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarizeToolArgValue(key, item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 32).map(([childKey, child]) => [childKey, summarizeToolArgValue(childKey, child, depth + 1)]));
}

const EDIT_TEXT_KEY = /(?:^|_)(?:content|old_string|new_string|oldText|newText)(?:$|_)/;

function stringLimit(key: string): number {
  if (key === "command") return 8_000;
  return EDIT_TEXT_KEY.test(key) ? 1_000 : 2_000;
}

function summarizeString(value: string, limit: number): unknown {
  return value.length <= limit ? value : { chars: value.length, preview: `${value.slice(0, limit)}…` };
}

function summarizeScalar(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value);
}

function toolResultSummary(tool: string, result: unknown, ok: boolean): string {
  const record = asRecord(result);
  if (!ok) return `${tool} failed: ${failureText(record).slice(0, 500)}`;
  const filePath = resultPath(record);
  const hash = contentHash(record)?.slice(0, 12);
  if (filePath) return `${tool} succeeded for ${filePath}${hash ? ` at ${hash}` : ""}`;
  if (tool === "bash_command") return `bash_command completed with exit code ${String(record?.exitCode ?? "unknown")}`;
  return `${tool} succeeded`;
}

function failureText(record: Record<string, unknown> | undefined): string {
  if (typeof record?.error === "string") return record.error;
  const details = asRecord(record?.acceptance)?.details;
  const text = Array.isArray(details) ? details.filter((detail): detail is string => typeof detail === "string").join("; ") : "";
  return text ? `acceptance criteria not met: ${text}` : "unknown error";
}

function contentHash(record: Record<string, unknown> | undefined): string | undefined {
  return typeof record?.content_hash === "string" ? record.content_hash : undefined;
}

function resultPath(record: Record<string, unknown> | undefined): string | undefined {
  if (typeof record?.file_path === "string") return record.file_path;
  return typeof record?.path === "string" ? record.path : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
