import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createFileSystemTools } from "../src/tools/fileSystemTools.js";

it("provides workspace-scoped read, write, edit, and bash tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-tools-"));
  try {
    const tools = new Map(createFileSystemTools({ rootDir: root }).map((tool) => [tool.name, tool]));
    await tools.get("write_file")?.execute({ file_path: "notes/todo.txt", content: "one\none\nthree" });
    await expect(tools.get("edit_file")?.execute({ file_path: "notes/todo.txt", old_string: "one", new_string: "two" })).rejects.toThrow(/replace_all=true/);
    await tools.get("edit_file")?.execute({ file_path: "notes/todo.txt", old_string: "one", new_string: "two", replace_all: true });
    const read = await tools.get("read_file")?.execute({ file_path: "notes/todo.txt", offset: 0, limit: 2 });
    expect(read).toMatchObject({ path: "notes/todo.txt", file_path: "notes/todo.txt", content: "two\ntwo" });
    const bash = await tools.get("bash_command")?.execute({ command: "pwd && ls notes", timeout_ms: 1000 });
    expect(bash).toMatchObject({ exitCode: 0 });
    expect(String((bash as { stdout: string }).stdout)).toContain(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects stale hash-guarded edits and returns current evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-tools-hash-"));
  try {
    const tools = new Map(createFileSystemTools({ rootDir: root }).map((tool) => [tool.name, tool]));
    await tools.get("write_file")?.execute({ file_path: "config.json", content: "{\"retryLimit\":3}" });
    const first = await tools.get("read_file")?.execute({ file_path: "config.json" }) as { content_hash: string };
    await tools.get("write_file")?.execute({ file_path: "config.json", content: "{\"retryLimit\":4}" });
    await expect(tools.get("edit_file")?.execute({ file_path: "config.json", old_string: "4", new_string: "5", expected_hash: first.content_hash })).rejects.toThrow(/File version mismatch[\s\S]*Current file preview/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects non-allowlisted and shell-escape bash commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-tools-"));
  try {
    const bash = createFileSystemTools({ rootDir: root }).find((tool) => tool.name === "bash_command");
    await expect(bash?.execute({ command: "curl https://example.com" })).rejects.toThrow(/not allowlisted/);
    await expect(bash?.execute({ command: "git status" })).rejects.toThrow(/not allowlisted/);
    await expect(bash?.execute({ command: "ls $(pwd)" })).rejects.toThrow(/unsafe shell syntax/);
    await expect(bash?.execute({ command: "find . -delete" })).rejects.toThrow(/stateful find/);
    await expect(bash?.execute({ command: "node -e 'process.exit()'" })).rejects.toThrow(/limited/);
    await expect(bash?.execute({ command: "pwd && ls" })).resolves.toMatchObject({ exitCode: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects file paths outside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-tools-"));
  try {
    const read = createFileSystemTools({ rootDir: root }).find((tool) => tool.name === "read_file");
    await expect(read?.execute({ file_path: "../secret.txt" })).rejects.toThrow(/escapes the agent workspace/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
