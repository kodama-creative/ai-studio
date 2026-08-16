import { describe, expect, test } from "bun:test";

import type { StudioThread } from "@llm-space/studio";

import type { ProjectSourceTransport } from "@/shared/project-source-rpc";
import type { StudioTransport } from "@/shared/studio-rpc";

import { ProjectSourceController } from "./project-source-controller";
import { ProjectThreadsController } from "./project-threads-controller";
import { ProjectWorkspaceController } from "./project-workspace-controller";

describe("ProjectWorkspaceController", () => {
  test("owns initial Thread selection, tab fallback, and projected titles", async () => {
    const initial = _thread("thread-a", "Initial");
    const controller = _workspace({
      studioClient: _studioClient({
        listThreads: () => Promise.resolve([initial]),
        loadThread: () => Promise.resolve(initial),
      }),
      sourceClient: _sourceClient({
        readSourceFile: () => Promise.resolve("export default {}"),
      }),
      reportError: (title, error) => {
        throw new Error(`${title}: ${String(error)}`);
      },
    });

    controller.start();
    await _eventually(
      () => controller.getSnapshot().activeTabId,
      "thread:thread-a"
    );
    await controller.openSourceFile("agent.ts");
    expect(controller.getSnapshot().activeTabId).toBe("code:agent.ts");

    controller.closeTab("code:agent.ts");
    expect(controller.getSnapshot().activeTabId).toBe("thread:thread-a");

    controller.acceptThreadProjection(_thread("thread-a", "Projected"));
    expect(controller.getSnapshot().tabs[0]?.title).toBe("Projected");
    controller.stop();
  });

  test("a stale Thread open cannot steal focus from a newer source selection", async () => {
    const pendingThread = _deferred<StudioThread>();
    const controller = _workspace({
      studioClient: _studioClient({
        listThreads: () => Promise.resolve([]),
        loadThread: () => pendingThread.promise,
      }),
      sourceClient: _sourceClient({
        readSourceFile: () => Promise.resolve("export default {}"),
      }),
      reportError: (title, error) => {
        throw new Error(`${title}: ${String(error)}`);
      },
    });
    controller.start();
    await _eventually(() => controller.getSnapshot().threads.loading, false);

    const staleThreadOpen = controller.openThread("thread-a");
    await controller.openSourceFile("agent.ts");
    pendingThread.resolve(_thread("thread-a", "Thread A"));
    await staleThreadOpen;

    expect(controller.getSnapshot().activeTabId).toBe("code:agent.ts");
    expect(controller.getSnapshot().tabs).toEqual([
      {
        id: "code:agent.ts",
        type: "code",
        path: "agent.ts",
        title: "agent.ts",
      },
    ]);
    controller.stop();
  });

  test("a stale source open cannot steal focus from a newer Thread selection", async () => {
    const pendingSource = _deferred<string>();
    const thread = _thread("thread-a", "Thread A");
    const controller = _workspace({
      studioClient: _studioClient({
        listThreads: () => Promise.resolve([]),
        loadThread: () => Promise.resolve(thread),
      }),
      sourceClient: _sourceClient({
        readSourceFile: () => pendingSource.promise,
      }),
      reportError: (title, error) => {
        throw new Error(`${title}: ${String(error)}`);
      },
    });
    controller.start();
    await _eventually(() => controller.getSnapshot().threads.loading, false);

    const staleSourceOpen = controller.openSourceFile("agent.ts");
    await controller.openThread(thread.id);
    pendingSource.resolve("export default {}");
    await staleSourceOpen;

    expect(controller.getSnapshot().activeTabId).toBe("thread:thread-a");
    expect(controller.getSnapshot().tabs).toEqual([
      {
        id: "thread:thread-a",
        type: "thread",
        threadId: "thread-a",
        title: "Thread A",
      },
    ]);
    controller.stop();
  });
});

function _workspace(options: {
  studioClient: StudioTransport;
  sourceClient: ProjectSourceTransport;
  reportError: (title: string, error: unknown) => void;
}): ProjectWorkspaceController {
  return new ProjectWorkspaceController(
    new ProjectThreadsController({
      client: options.studioClient,
      reportError: options.reportError,
    }),
    new ProjectSourceController({
      client: options.sourceClient,
      reportError: options.reportError,
    })
  );
}

function _studioClient(
  overrides: Partial<StudioTransport> = {}
): StudioTransport {
  const thread = _thread("thread-a", "Thread A");
  return {
    listThreads: () => Promise.resolve([]),
    listRunHistory: () => Promise.resolve([]),
    saveRunHistory: () => Promise.resolve([]),
    listEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    saveEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    forkThread: () => Promise.resolve(thread),
    createThread: () => Promise.resolve(thread),
    loadThread: () => Promise.resolve(thread),
    saveDocument: () => Promise.resolve(thread),
    events: () => _items([]),
    ...overrides,
  };
}

function _sourceClient(
  overrides: Partial<ProjectSourceTransport> = {}
): ProjectSourceTransport {
  return {
    readSourceFile: () => Promise.resolve(""),
    watchSourceFiles: () => _items([]),
    ...overrides,
  };
}

function _thread(id: string, title: string): StudioThread {
  return {
    schemaVersion: 1,
    id,
    sessionId: `session-${id}`,
    lane: "main",
    leafId: null,
    runtimeFormatVersion: 1,
    document: {
      title,
      agent: {
        agentSpecId: "agent-1",
        sourceRevision: "source-1",
        model: "test/model",
        instructions: [],
        tools: [],
      },
      conversation: { messages: [], state: {} },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function _items<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let index = 0;
      return {
        next: () =>
          Promise.resolve(
            index < items.length
              ? { done: false, value: items[index++] }
              : { done: true, value: undefined }
          ),
      };
    },
  };
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (read() === expected) return;
    await Promise.resolve();
  }
  expect(read()).toBe(expected);
}
