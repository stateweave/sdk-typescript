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

it("rejects file paths outside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-tools-"));
  try {
    const read = createFileSystemTools({ rootDir: root }).find((tool) => tool.name === "read_file");
    await expect(read?.execute({ file_path: "../secret.txt" })).rejects.toThrow(/escapes the agent workspace/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
