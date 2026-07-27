import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import {
  duplicateExternalAgentProjectThreadState,
  ExternalAgentProjectManager
} from "../../../src/bun/external-projects/external-agent-project-manager";

const ROOTS: string[] = [];
const MANAGERS: ExternalAgentProjectManager[] = [];

afterEach(async () => {
  await Promise.all(MANAGERS.splice(0).map(async manager => manager.shutdown()));
  await Promise.all(ROOTS.splice(0).map(async root =>
    rm(root, { recursive: true, force: true })));
});

async function _fixture() {
  const root = path.join(tmpdir(), `llm-space-manager-${crypto.randomUUID()}`);
  const home = path.join(root, "home");
  const workspace = path.join(home, "workspace");
  const project = path.join(root, "project");
  ROOTS.push(root);
  await mkdir(path.join(project, "agent", "tools"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(project, "llm-space.json"),
    JSON.stringify({ schemaVersion: 1, agent: "./agent" })
  );
  await writeFile(
    path.join(project, "agent", "agent.ts"),
    `export default { model: "openai/gpt-5.3-codex", reasoning: "high" };`
  );
  await writeFile(
    path.join(project, "agent", "instructions.md"),
    "Use echo for every request.\n"
  );
  await writeFile(
    path.join(project, "agent", "tools", "echo.ts"),
    `import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";
export default defineTool({
  description: "Echo text",
  inputSchema: Type.Object({ text: Type.String() }),
  execute({ text }) { return { text }; }
});`
  );
  const manager = new ExternalAgentProjectManager({
    homePath: home,
    workspaceRoot: workspace,
    sandboxReadiness: async () => Promise.resolve({ state: "ready" })
  });
  MANAGERS.push(manager);
  return { manager, project };
}

test("duplicates editable state into a fresh Session for every Runtime Profile", () => {
  for (const profile of [
    { version: 1, type: "desktopDirect" },
    { version: 1, type: "desktopSandbox" },
    {
      version: 1,
      type: "localServer",
      artifactFingerprint: "a".repeat(64),
      serverSessionId: "server-session"
    }
  ] as const) {
    const messages = [{
      id: `message-${profile.type}`,
      role: "user" as const,
      content: [{ type: "text" as const, text: `keep-${profile.type}` }]
    }];
    const source: Thread = {
      title: profile.type,
      model: { provider: "fake", id: "model" },
      runtimeProfile: profile,
      context: {
        messages,
        snapshot: { variables: { prompt: { value: "run-only" } } }
      },
      runtimeSession: { budget: `do-not-copy-${profile.type}` },
      runtimeWorkingBase: {
        sessionId: `session-${profile.type}`,
        branchId: "branch-one",
        checkpointId: "checkpoint-one"
      },
      runHistory: [{
        id: `run-${profile.type}`,
        thread: { title: "Historical", context: { messages } },
        timestamp: 1
      }]
    };

    const duplicate = duplicateExternalAgentProjectThreadState(source);

    expect(duplicate.title).toBe(`${profile.type} copy`);
    expect(duplicate.context?.messages).toEqual(messages);
    expect(duplicate.context?.snapshot).toBeUndefined();
    expect(duplicate.model).toEqual(source.model);
    expect(duplicate.runtimeSession).toBeUndefined();
    expect(duplicate.runtimeWorkingBase).toBeUndefined();
    expect(duplicate.runHistory).toBeUndefined();
    expect(duplicate.evaluations).toBeUndefined();
    expect(duplicate.sandboxAttachments).toBeUndefined();
    expect(duplicate.runtimeProfile).toEqual(profile.type === "localServer"
      ? {
        version: 1,
        type: "localServer",
        artifactFingerprint: profile.artifactFingerprint
      }
      : { version: 1, type: profile.type });
  }
});

describe("ExternalAgentProjectManager inspector", () => {
  test("keeps a missing required source repairable in an external editor", async () => {
    const { manager, project } = await _fixture();
    await rm(path.join(project, "agent", "instructions.md"));

    const opened = await manager.trustAndOpen(project);
    expect(opened.status).toBe("invalid");
    expect(opened.threads).toEqual([]);
    expect(opened.diagnostics).toContainEqual(expect.objectContaining({
      code: "instructions_missing",
      sourcePath: "instructions.md"
    }));
    expect(await manager.editorTarget(opened.id, "instructions.md")).toBe(
      path.join(await realpath(project), "agent", "instructions.md")
    );
  });

  test("projects a safe artifact summary and confined editor targets", async () => {
    const { manager, project } = await _fixture();
    const opened = await manager.trustAndOpen(project);

    expect(opened.artifactSummary).toMatchObject({
      fingerprint: opened.artifactFingerprint,
      model: {
        id: "openai/gpt-5.3-codex",
        dynamic: false,
        reasoning: "high"
      },
      environment: [],
      sandbox: null
    });
    expect(opened.artifactSummary?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "instructions",
          sourcePath: "instructions.md"
        }),
        expect.objectContaining({
          kind: "tool",
          name: "echo",
          sourcePath: "tools/echo.ts"
        })
      ])
    );
    expect(await manager.editorTarget(opened.id)).toBe(await realpath(project));
    expect(await manager.editorTarget(opened.id, "tools/echo.ts")).toBe(
      await realpath(path.join(project, "agent", "tools", "echo.ts"))
    );
    expect(await manager.editorTarget(opened.id, "outputs/result.ts")).toBe(
      path.join(await realpath(project), "agent", "outputs", "result.ts")
    );
    expect(manager.editorTarget(opened.id, "../llm-space.json"))
      .rejects.toThrow("escapes the Agent root");
  });

  test("settles only the newest watched source revision", async () => {
    const { manager, project } = await _fixture();
    const opened = await manager.trustAndOpen(project);
    const states: string[] = [];
    const settled = new Promise<void>(resolve => {
      manager.setOnChange(projectId => {
        if (projectId !== opened.id) { return; }
        void manager.inspect(projectId).then(view => {
          states.push(view.status);
          if (view.status === "ready") { resolve(); }
        });
      });
    });

    await writeFile(
      path.join(project, "agent", "instructions.md"),
      "First external edit.\n"
    );
    await writeFile(
      path.join(project, "agent", "instructions.md"),
      "Newest external edit.\n"
    );

    await settled;
    expect(states).toContain("building");
    expect((await manager.inspect(opened.id)).status).toBe("ready");
    expect((await manager.inspect(opened.id)).instructions).toBe(
      "Newest external edit.\n"
    );
    expect((await manager.inspect(opened.id)).threads).toEqual([]);
  });
});
