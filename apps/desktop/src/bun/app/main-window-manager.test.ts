import { expect, test } from "bun:test";

import { Emitter } from "../../shared/event";

import { MainWindowManager } from "./main-window-manager";

test("native Main close clears the handle and the next open recreates it", async () => {
  const ids: number[] = [];
  let nextId = 0;
  const manager = new MainWindowManager({
    async createMain() {
      const id = ++nextId;
      ids.push(id);
      const didClose = new Emitter<void>();
      return Promise.resolve({
        id,
        activate: () => undefined,
        close: () => didClose.fire(),
        onDidClose: didClose.event,
        closeNative: () => didClose.fire(),
      });
    },
  });

  const first = await manager.open();
  expect(first.id).toBe(1);
  first.closeNative();
  await Bun.sleep(0);
  expect(manager.current()).toBeUndefined();
  expect((await manager.open()).id).toBe(2);
  expect(ids).toEqual([1, 2]);
  await manager.close();
});

test("concurrent Main opens share creation and activate the result", async () => {
  let createCount = 0;
  let activations = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const manager = new MainWindowManager({
    createMain: () => {
      createCount += 1;
      return gate.then(() => ({
        activate: () => {
          activations += 1;
        },
        close: () => undefined,
        onDidClose: _emptyEvent,
      }));
    },
  });

  const first = manager.open();
  const second = manager.open();
  finish();
  expect(await first).toBe(await second);
  expect(createCount).toBe(1);
  expect(activations).toBe(1);
  await manager.close();
});

test("shutdown drains a Main window already being created", async () => {
  let finish!: () => void;
  let notifyStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let closes = 0;
  const manager = new MainWindowManager({
    async createMain() {
      notifyStarted();
      await gate;
      return {
        activate: () => undefined,
        close: () => {
          closes += 1;
        },
        onDidClose: _emptyEvent,
      };
    },
  });

  const opening = manager.open();
  await started;
  const closing = manager.close();
  expect(manager.open()).rejects.toThrow("Main window is shutting down.");
  finish();

  await Promise.all([opening, closing]);
  expect(closes).toBe(1);
});

test("a failed Main creation is never retained", async () => {
  let attempts = 0;
  const manager = new MainWindowManager({
    createMain: () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("creation failed"));
      return Promise.resolve({
        activate: () => undefined,
        close: () => undefined,
        onDidClose: _emptyEvent,
      });
    },
  });

  const opening = manager.open();
  expect(opening).rejects.toThrow("creation failed");
  await opening.catch(() => undefined);
  expect(manager.current()).toBeUndefined();
  expect(await manager.open()).toBeDefined();
});

test("a Main closed during creation is not retained", async () => {
  let attempts = 0;
  const manager = new MainWindowManager({
    createMain: () => {
      attempts += 1;
      return Promise.resolve({
        activate: () => undefined,
        close: () => undefined,
        onDidClose: (listener: () => void) => {
          listener();
          return { dispose: () => undefined };
        },
      });
    },
  });

  await manager.open();
  expect(manager.current()).toBeUndefined();
  await manager.open();
  expect(attempts).toBe(2);
});

function _emptyEvent(): { dispose(): void } {
  return { dispose: () => undefined };
}
