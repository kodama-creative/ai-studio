import { describe, expect, test } from "bun:test";

import type { StudioThread, StudioThreadEvent } from "@llm-space/studio";

import type { ProjectStudioTransport } from "@/shared/project-studio";

import { ProjectThreadsController } from "./project-threads-controller";

describe("ProjectThreadsController", () => {
  test("publishes only the newest concurrent open", async () => {
    const pending = new Map<string, ReturnType<typeof _deferred<StudioThread>>>();
    const eventSignals: AbortSignal[] = [];
    const errors: string[] = [];
    const client = _client({
      listThreads: () => Promise.resolve([]),
      loadThread: (id) => {
        const result = _deferred<StudioThread>();
        pending.set(id, result);
        return result.promise;
      },
      events: (_id, cursor) => {
        if (cursor?.signal) eventSignals.push(cursor.signal);
        return _untilAborted(cursor?.signal);
      },
    });
    const controller = new ProjectThreadsController({
      client,
      reportError: (title) => errors.push(title),
    });
    await controller.start();

    const first = controller.open("thread-a");
    const second = controller.open("thread-b");
    pending.get("thread-b")!.resolve(_thread("thread-b", "B"));
    expect(await second).toMatchObject({ id: "thread-b" });
    pending.get("thread-a")!.resolve(_thread("thread-a", "A"));
    expect(await first).toBeUndefined();

    expect(controller.getSnapshot().activeThread).toMatchObject({
      id: "thread-b",
      document: { title: "B" },
    });
    expect(errors).toEqual([]);
    controller.stop();
    expect(eventSignals).toHaveLength(1);
    expect(eventSignals[0].aborted).toBeTrue();
  });

  test("owns event replay, terminal refresh, and restartable cleanup", async () => {
    const initial = _thread("thread-a", "Initial");
    const streamed = _thread("thread-a", "Streaming");
    const completed = _thread("thread-a", "Completed");
    const cursors: (number | undefined)[] = [];
    let loadCount = 0;
    let listCount = 0;
    let historyCount = 0;
    let evaluationCount = 0;
    const client = _client({
      listThreads: () => {
        listCount += 1;
        return Promise.resolve([listCount === 1 ? initial : completed]);
      },
      loadThread: () => {
        loadCount += 1;
        return Promise.resolve(loadCount === 1 ? initial : completed);
      },
      listRunHistory: () => {
        historyCount += 1;
        return Promise.resolve([]);
      },
      listEvaluationMetadata: () => {
        evaluationCount += 1;
        return Promise.resolve({ evaluations: [], rubrics: [] });
      },
      events: (_id, cursor) => {
        cursors.push(cursor?.afterSequence);
        return cursors.length === 1
          ? _events([
              _event(1, {
                type: "conversation.updated",
                operationId: "operation-1",
                thread: streamed,
              }),
              _event(2, {
                type: "operation.completed",
                operationId: "operation-1",
              }),
            ])
          : _events([]);
      },
    });
    const controller = new ProjectThreadsController({
      client,
      reportError: (title, error) => {
        throw new Error(`${title}: ${String(error)}`);
      },
    });

    expect(await controller.start()).toMatchObject({ id: "thread-a" });
    await _eventually(
      () => controller.getSnapshot().activeThread?.document.title,
      "Completed"
    );
    expect(controller.getSnapshot().threads[0]?.document.title).toBe(
      "Completed"
    );
    expect(listCount).toBe(2);
    expect(historyCount).toBe(2);
    expect(evaluationCount).toBe(2);

    await controller.open("thread-a");
    expect(cursors).toEqual([undefined, 2]);

    controller.stop();
    expect(await controller.start()).toMatchObject({ id: "thread-a" });
    expect(controller.getSnapshot().loading).toBeFalse();
    controller.stop();
  });

  test("a failed create keeps the active Thread subscription alive", async () => {
    const thread = _thread("thread-a", "A");
    const signals: AbortSignal[] = [];
    const errors: string[] = [];
    const client = _client({
      listThreads: () => Promise.resolve([thread]),
      loadThread: () => Promise.resolve(thread),
      createThread: () => Promise.reject(new Error("create failed")),
      events: (_id, cursor) => {
        if (cursor?.signal) signals.push(cursor.signal);
        return _untilAborted(cursor?.signal);
      },
    });
    const controller = new ProjectThreadsController({
      client,
      reportError: (title) => errors.push(title),
    });

    await controller.start();
    expect(await controller.create()).toBeUndefined();

    expect(controller.getSnapshot().activeThread?.id).toBe("thread-a");
    expect(errors).toEqual(["Unable to create Thread"]);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBeFalse();
    controller.stop();
    expect(signals[0].aborted).toBeTrue();
  });
});

function _client(
  overrides: Partial<ProjectStudioTransport>
): ProjectStudioTransport {
  const thread = _thread("thread-a", "Thread A");
  return {
    getSourceRevision: () => Promise.resolve("source-1"),
    listSourceFiles: () => Promise.resolve([]),
    readSourceFile: () => Promise.resolve(""),
    listThreads: () => Promise.resolve([thread]),
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
    watchSourceFiles: () => _events([]),
    events: () => _events([]),
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

function _event(
  sequence: number,
  event: StudioThreadEvent["event"]
): StudioThreadEvent {
  return {
    threadId: "thread-a",
    sequence,
    timestamp: sequence,
    event,
  };
}

function _events<T>(items: readonly T[]): AsyncIterable<T> {
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

function _untilAborted(signal?: AbortSignal): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<never> {
      return {
        next: () => {
          if (signal?.aborted) {
            return Promise.resolve({ done: true, value: undefined });
          }
          return new Promise((resolve) =>
            signal?.addEventListener(
              "abort",
              () => resolve({ done: true, value: undefined }),
              { once: true }
            )
          );
        },
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
