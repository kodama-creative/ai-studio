import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProjectSourceFiles } from "./project-source-files";

test("ProjectSourceFiles exposes a read-only filtered project tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-source-tree-"));
  try {
    await mkdir(join(root, "agent", "tools"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "node_modules", "dep"), { recursive: true });
    await mkdir(join(root, "threads"), { recursive: true });
    await writeFile(join(root, "agent", "agent.ts"), "export default {};\n");
    await writeFile(join(root, "agent", "tools", "read.ts"), "export {};\n");
    await writeFile(join(root, ".git", "HEAD"), "secret\n");
    await writeFile(join(root, "threads", "thread.json"), "{}\n");

    const files = new ProjectSourceFiles(root);
    expect(await files.list()).toEqual([
      {
        name: "agent",
        path: "agent",
        type: "directory",
        children: [
          { name: "agent.ts", path: "agent/agent.ts", type: "file" },
          {
            name: "tools",
            path: "agent/tools",
            type: "directory",
            children: [
              { name: "read.ts", path: "agent/tools/read.ts", type: "file" },
            ],
          },
        ],
      },
    ]);
    expect(await files.read("agent/agent.ts")).toBe("export default {};\n");
    expect(files.read("../outside.txt")).rejects.toThrow(
      "outside the Agent Project"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ProjectSourceFiles watches the project and publishes a refreshed tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-source-watch-"));
  const controller = new AbortController();
  try {
    await mkdir(join(root, "agent"), { recursive: true });
    await writeFile(join(root, "agent", "agent.ts"), "export default {};\n");
    const files = new ProjectSourceFiles(root);
    const iterator = files.watch({ signal: controller.signal })[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toHaveLength(1);
    const changed = iterator.next();
    await writeFile(join(root, "agent", "instructions.md"), "Be helpful.\n");

    expect((await changed).value).toEqual([
      {
        name: "agent",
        path: "agent",
        type: "directory",
        children: [
          { name: "agent.ts", path: "agent/agent.ts", type: "file" },
          {
            name: "instructions.md",
            path: "agent/instructions.md",
            type: "file",
          },
        ],
      },
    ]);
  } finally {
    controller.abort();
    await rm(root, { recursive: true, force: true });
  }
});
