import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  ExternalEditorManager,
  type ExternalEditorSystem
} from "../../../src/bun/external-editor";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root =>
    rm(root, { recursive: true, force: true })));
});

async function _fixture(options: {
  commands?: Record<string, string>;
  existingApps?: string[];
  platform?: NodeJS.Platform;
} = {}) {
  const homePath = await mkdtemp(path.join(tmpdir(), "external-editor-"));
  ROOTS.push(homePath);
  const launches: Array<{ args: readonly string[]; command: string; }> = [];
  const system: ExternalEditorSystem = {
    platform: options.platform ?? "linux",
    homeDirectory: "/Users/test",
    exists: async target => Boolean(options.existingApps?.includes(target)),
    launch(command, args) { launches.push({ command, args }); },
    which: command => options.commands?.[command] ?? null
  };
  return {
    homePath,
    launches,
    manager: new ExternalEditorManager({ homePath, system })
  };
}

describe("ExternalEditorManager", () => {
  test("reports only fixed editors and chooses the first available default", async () => {
    const { manager } = await _fixture({
      commands: { zed: "/usr/local/bin/zed" }
    });

    expect(await manager.status()).toEqual({
      editors: [
        { id: "vscode", label: "VS Code", available: false },
        { id: "zed", label: "Zed", available: true },
        { id: "cursor", label: "Cursor", available: false }
      ],
      preferredEditorId: "zed"
    });
  });

  test("opens a requested editor and persists the fixed editor id", async () => {
    const { homePath, launches, manager } = await _fixture({
      commands: {
        code: "/opt/bin/code",
        zed: "/opt/bin/zed"
      }
    });

    const status = await manager.open("/project/agent.ts", "zed");

    expect(launches).toEqual([
      { command: "/opt/bin/zed", args: ["/project/agent.ts"] }
    ]);
    expect(status.preferredEditorId).toBe("zed");
    expect(JSON.parse(await readFile(
      path.join(homePath, "settings", "external-editor.json"),
      "utf8"
    ))).toEqual({ preferredEditorId: "zed" });
  });

  test("uses the fixed macOS app fallback when no CLI is installed", async () => {
    const app = "/Applications/Visual Studio Code.app";
    const { launches, manager } = await _fixture({
      platform: "darwin",
      existingApps: [app]
    });

    await manager.open("/project", "vscode");

    expect(launches).toEqual([{
      command: "/usr/bin/open",
      args: ["-a", "Visual Studio Code", "/project"]
    }]);
  });

  test("fails without executing when no supported editor is available", async () => {
    const { launches, manager } = await _fixture();

    expect(manager.open("/project")).rejects.toThrow(
      "No supported editor was found"
    );
    expect(launches).toEqual([]);
  });
});
