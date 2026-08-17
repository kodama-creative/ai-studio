import { describe, expect, test } from "bun:test";

import type { ProjectSourceSnapshot } from "@/shared/project-source-rpc";

import type { RendererNotificationService } from "../notifications/renderer-notification-service";

import { ProjectSourceController } from "./project-source-controller";

describe("ProjectSourceController", () => {
  test("owns the initial source stream and refreshes open documents", async () => {
    const source = _stream<ProjectSourceSnapshot>();
    const signals: AbortSignal[] = [];
    let content = "first";
    const errors: string[] = [];
    const controller = new ProjectSourceController(
      {
        readSourceFile: () => Promise.resolve(content),
        watchSourceFiles: ({ signal } = {}) => {
          if (signal) signals.push(signal);
          return source.iterable;
        },
      },
      _notifications((title) => errors.push(title))
    );

    controller.start();
    source.push(_snapshot("revision-1"));
    await _eventually(
      () => controller.getSnapshot().files[0]?.name,
      "agent.ts"
    );
    expect(controller.getSnapshot().loading).toBeFalse();
    expect(controller.getSnapshot().revision).toBe("revision-1");

    expect(await controller.open("agent.ts")).toBeTrue();
    expect(controller.getSnapshot().contentByPath.get("agent.ts")).toBe(
      "first"
    );

    content = "second";
    source.push(_snapshot("revision-2"));
    await _eventually(
      () => controller.getSnapshot().contentByPath.get("agent.ts"),
      "second"
    );
    expect(controller.getSnapshot().revision).toBe("revision-2");

    controller.close("agent.ts");
    expect(controller.getSnapshot().contentByPath.has("agent.ts")).toBeFalse();
    content = "third";
    source.push(_snapshot("revision-3"));
    await _eventually(
      () => controller.getSnapshot().revision,
      "revision-3"
    );
    expect(controller.getSnapshot().contentByPath.has("agent.ts")).toBeFalse();
    expect(errors).toEqual([]);

    controller.stop();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBeTrue();
  });

  test("deduplicates concurrent opens through its interface", async () => {
    const source = _stream<ProjectSourceSnapshot>();
    const pending = _deferred<string>();
    let reads = 0;
    const controller = new ProjectSourceController(
      {
        readSourceFile: () => {
          reads += 1;
          return pending.promise;
        },
        watchSourceFiles: () => source.iterable,
      },
      _notifications((title, error) => {
        throw new Error(`${title}: ${String(error)}`);
      })
    );
    controller.start();
    source.push(_snapshot("revision-1"));
    await _eventually(() => controller.getSnapshot().loading, false);

    const first = controller.open("agent.ts");
    const second = controller.open("agent.ts");
    expect(reads).toBe(1);
    pending.resolve("content");
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(controller.getSnapshot().contentByPath.get("agent.ts")).toBe(
      "content"
    );
    controller.stop();
  });

  test("does not publish a read completed after stop", async () => {
    const source = _stream<ProjectSourceSnapshot>();
    const pending = _deferred<string>();
    const errors: string[] = [];
    const controller = new ProjectSourceController(
      {
        readSourceFile: () => pending.promise,
        watchSourceFiles: () => source.iterable,
      },
      _notifications((title) => errors.push(title))
    );
    controller.start();
    source.push(_snapshot("revision-1"));
    await _eventually(() => controller.getSnapshot().loading, false);

    const read = controller.open("agent.ts");
    controller.stop();
    pending.resolve("late content");

    expect(await read).toBeFalse();
    expect(controller.getSnapshot().contentByPath.has("agent.ts")).toBeFalse();
    expect(errors).toEqual([]);
  });
});

function _notifications(
  reportError: (title: string, error?: unknown) => void
): RendererNotificationService {
  return { error: reportError } as RendererNotificationService;
}

function _snapshot(revision: string): ProjectSourceSnapshot {
  return {
    revision,
    files: [{ name: "agent.ts", path: "agent.ts", type: "file" }],
  };
}

function _stream<T>() {
  const values: T[] = [];
  const waiters: ((result: IteratorResult<T>) => void)[] = [];
  return {
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            const value = values.shift();
            if (value !== undefined) {
              return Promise.resolve({ done: false, value });
            }
            return new Promise((resolve) => waiters.push(resolve));
          },
        };
      },
    } satisfies AsyncIterable<T>,
    push(value: T): void {
      const waiter = waiters.shift();
      if (waiter === undefined) values.push(value);
      else waiter({ done: false, value });
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
