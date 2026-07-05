import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createFileSystemTools } from "../src/tools/fileSystemTools.js";

it("provides workspace-scoped read, write, edit, and bash tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stateweave-tools-"));
  try {
    const tools = new Map(createFileSystemTools({ rootDir: root }).map((tool) => [tool.name, tool]));
    await tools.get("write_file")?.execute({ path: "notes/todo.txt", content: "one" });
    await tools.get("edit_file")?.execute({ path: "notes/todo.txt", oldText: "one", newText: "two" });
    const read = await tools.get("read_file")?.execute({ path: "notes/todo.txt" });
    expect(read).toMatchObject({ path: "notes/todo.txt", content: "two" });
    const bash = await tools.get("bash_command")?.execute({ command: "pwd && ls notes" });
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
    await expect(read?.execute({ path: "../secret.txt" })).rejects.toThrow(/escapes the agent workspace/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
