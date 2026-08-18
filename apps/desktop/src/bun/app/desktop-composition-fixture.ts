import { mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as inversify from "inversify";

const events: string[] = [];
const dataRoot = mkdtempSync(path.join(tmpdir(), "llm-space-composition-"));
process.env.LLM_SPACE_HOME = dataRoot;

class TrackingContainer extends inversify.Container {
  override async unbindAllAsync(): Promise<void> {
    events.push("container:unbind");
    await super.unbindAllAsync();
  }
}

await mock.module("inversify", () => ({
  ...inversify,
  Container: TrackingContainer,
}));
await mock.module("electrobun/bun", () => ({
  default: { events: { on: () => undefined } },
  app: {},
  ApplicationMenu: {},
  BrowserWindow: class {},
  BrowserView: { defineRPC: () => ({ send: {} }) },
  Updater: class {},
  Utils: {},
}));
await mock.module("../workspace/seed", () => ({
  seedWorkspace: () => events.push("workspace:seed"),
}));
await mock.module("../skills/seed", () => ({
  getManagedSkillsDir: () => path.join(dataRoot, "skills"),
  seedSkills: () => events.push("skills:seed"),
}));
await mock.module("../analytics", () => ({
  Analytics: class {
    constructor() {
      events.push("analytics:create");
    }

    shutdown(): void {
      events.push("analytics:stop");
    }
  },
}));
await mock.module("@llm-space/runtime/mcp", () => ({
  McpManager: class {
    constructor() {
      events.push("mcp:create");
    }

    shutdown(): void {
      events.push("mcp:stop");
    }
  },
}));
await mock.module("../host/desktop-host", () => ({
  DesktopHost: class {
    constructor() {
      events.push("host:create");
    }

    start(): never {
      events.push("host:start");
      throw new Error("host startup failed");
    }

    stop(): void {
      events.push("host:stop");
    }
  },
}));

try {
  const { composeAndStartDesktopApp } = await import("./desktop-composition");
  await composeAndStartDesktopApp({} as never);
  throw new Error("Desktop composition unexpectedly succeeded.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "host startup failed") {
    throw error;
  }
} finally {
  rmSync(dataRoot, { force: true, recursive: true });
}

const expected = [
  "workspace:seed",
  "skills:seed",
  "analytics:create",
  "mcp:create",
  "host:create",
  "host:start",
  "host:stop",
  "mcp:stop",
  "analytics:stop",
  "container:unbind",
];
if (JSON.stringify(events) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected composition cleanup: ${events.join(", ")}`);
}
