import { describe, expect, test } from "bun:test";

import type {
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView,
} from "@llm-space/core";

import {
  McpSettingsController,
  type McpSettingsClient,
} from "./mcp-settings-controller";

describe("McpSettingsController", () => {
  test("serializes debounced edits without dropping a newer form", async () => {
    const firstSave = _deferred<McpServerView[]>();
    const secondSave = _deferred<McpServerView[]>();
    const drafts: McpServerDraft[] = [];
    const controller = new McpSettingsController(
      _client({
        listServers: () => Promise.resolve([_server("server-a", "Alpha")]),
        updateServer: (_id, draft) => {
          drafts.push(draft);
          return drafts.length === 1 ? firstSave.promise : secondSave.promise;
        },
      }),
      _notifications({
        error: (title, error) => {
          throw new Error(`${title}: ${String(error)}`);
        },
      }),
      0
    );

    controller.start();
    await _eventually(() => controller.getSnapshot().loading, false);
    expect(controller.getSnapshot()).toMatchObject({
      selectedId: "server-a",
      form: { name: "Alpha", command: "alpha" },
      dirty: false,
    });

    controller.updateForm({
      ...controller.getSnapshot().form,
      name: "Alpha One",
    });
    await _eventually(() => drafts.length, 1);
    expect(controller.getSnapshot().saving).toBeTrue();
    expect(drafts[0]?.name).toBe("Alpha One");

    controller.updateForm({
      ...controller.getSnapshot().form,
      name: "Alpha Two",
    });
    firstSave.resolve([_server("server-a", "Alpha One")]);
    await _flushMicrotasks();
    expect(controller.getSnapshot()).toMatchObject({
      saving: false,
      form: { name: "Alpha Two" },
      dirty: true,
      formError: null,
    });
    await _eventually(() => drafts.length, 2);
    expect(drafts[1]?.name).toBe("Alpha Two");
    secondSave.resolve([_server("server-a", "Alpha Two")]);
    await _flushMicrotasks();
    expect(controller.getSnapshot().form.name).toBe("Alpha Two");
    controller.stop();
  });

  test("creates only after the draft becomes valid and restores selection on cancel", async () => {
    const added: McpServerDraft[] = [];
    const alpha = _server("server-a", "Alpha");
    const beta = _server("server-b", "Beta");
    const controller = new McpSettingsController(
      _client({
        listServers: () => Promise.resolve([alpha]),
        addServer: (draft) => {
          added.push(draft);
          return Promise.resolve([alpha, beta]);
        },
      }),
      _notifications({
        error: (title, error) => {
          throw new Error(`${title}: ${String(error)}`);
        },
      }),
      0
    );
    controller.start();
    await _eventually(() => controller.getSnapshot().loading, false);

    controller.beginCreate();
    controller.updateForm({
      ...controller.getSnapshot().form,
      name: "Beta",
    });
    await _nextTimer();
    expect(added).toHaveLength(0);
    controller.cancelCreate();
    expect(controller.getSnapshot()).toMatchObject({
      creating: false,
      selectedId: "server-a",
      form: { name: "Alpha" },
    });

    controller.beginCreate();
    controller.updateForm({
      ...controller.getSnapshot().form,
      name: "Beta",
      command: "beta",
      argsText: "--one\n\n --two ",
    });
    await _eventually(() => added.length, 1);
    await _flushMicrotasks();

    expect(added).toEqual([
      {
        name: "Beta",
        useOriginalToolNames: false,
        transport: "stdio",
        command: "beta",
        args: ["--one", "--two"],
        cwd: null,
        env: undefined,
      },
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      creating: false,
      selectedId: "server-b",
      form: { name: "Beta" },
      dirty: false,
    });
    controller.stop();
  });

  test("discards a test success that arrives after cancellation", async () => {
    const tools = _deferred<McpServerToolsResponse>();
    const notifications: string[] = [];
    const server = _server("server-a", "Alpha");
    const controller = new McpSettingsController(
      _client({
        listServers: () => Promise.resolve([server]),
        listTools: () => tools.promise,
        cancelTest: () => Promise.resolve([server]),
      }),
      _notifications({
        success: (title) => notifications.push(title),
        error: (title) => notifications.push(title),
      })
    );
    controller.start();
    await _eventually(() => controller.getSnapshot().loading, false);

    const testing = controller.testSelected();
    expect(controller.getSnapshot().testingServerId).toBe("server-a");
    await controller.cancelTest();
    tools.resolve({
      server: { ...server, connected: true },
      tools: [],
    });
    await testing;

    expect(controller.getSnapshot()).toMatchObject({
      testingServerId: null,
      cancellingTest: false,
      tools: [],
    });
    expect(controller.getSnapshot().servers[0]?.connected).toBeFalse();
    expect(notifications).toEqual([]);
    controller.stop();
  });

  test("ignores a refresh result completed after stop", async () => {
    const servers = _deferred<McpServerView[]>();
    const controller = new McpSettingsController(
      _client({ listServers: () => servers.promise }),
      _notifications()
    );
    controller.start();
    controller.stop();
    servers.resolve([_server("server-a", "Late")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot().servers).toEqual([]);
  });
});

function _client(
  overrides: Partial<McpSettingsClient>
): McpSettingsClient {
  return {
    listServers: () => Promise.resolve([]),
    addServer: () => Promise.resolve([]),
    updateServer: () => Promise.resolve([]),
    removeServer: () => Promise.resolve([]),
    disconnectServer: () => Promise.resolve([]),
    cancelTest: () => Promise.resolve([]),
    listTools: () =>
      Promise.reject(new Error("Unexpected MCP tools request.")),
    ...overrides,
  };
}

function _notifications(
  overrides: Partial<{
    success(message: string): void;
    error(title: string, error?: unknown): void;
  }> = {}
) {
  return {
    success: () => undefined,
    error: () => undefined,
    ...overrides,
  };
}

function _server(id: string, name: string): McpServerView {
  return {
    id,
    name,
    serverName: name.replaceAll(" ", "_"),
    transport: "stdio",
    command: name.toLowerCase().replaceAll(" ", "-"),
    args: [],
    cwd: null,
    createdAt: 1,
    updatedAt: 1,
    connected: false,
    toolCount: null,
  };
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (read() === expected) return;
    await _nextTimer();
  }
  expect(read()).toBe(expected);
}

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function _nextTimer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
