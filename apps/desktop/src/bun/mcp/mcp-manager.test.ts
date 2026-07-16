import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";

import { McpManager } from "./mcp-manager";

const ORIGINAL_LLM_SPACE_HOME = process.env.LLM_SPACE_HOME;
const TEMP_ROOTS: string[] = [];

afterEach(() => {
  if (ORIGINAL_LLM_SPACE_HOME === undefined) {
    delete process.env.LLM_SPACE_HOME;
  } else {
    process.env.LLM_SPACE_HOME = ORIGINAL_LLM_SPACE_HOME;
  }
  for (const root of TEMP_ROOTS.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("McpManager removes persisted SSE servers without dropping supported servers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "llm-space-mcp-"));
  TEMP_ROOTS.push(root);
  process.env.LLM_SPACE_HOME = root;
  const settingsDir = path.join(root, "settings");
  const configPath = path.join(settingsDir, "mcp.json");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({
      servers: [
        {
          id: "legacy-sse",
          name: "Legacy SSE",
          serverName: "legacy_sse",
          transport: "sse",
          url: "https://example.com/sse"
        },
        {
          id: "local-stdio",
          name: "Local stdio",
          serverName: "local_stdio",
          transport: "stdio",
          command: "example-mcp"
        }
      ]
    }, null, 2)}\n`,
    "utf8"
  );

  const manager = new McpManager();

  expect(manager.listServers().map(server => server.id)).toEqual([
    "local-stdio"
  ]);
  const persisted = JSON.parse(readFileSync(configPath, "utf8")) as {
    servers: Array<{ id: string; transport: string; }>;
  };
  expect(persisted.servers).toEqual([
    expect.objectContaining({ id: "local-stdio", transport: "stdio" })
  ]);
});
