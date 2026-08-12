import { expect, test } from "bun:test";

import { createDesktopProcessContainer } from "../di/process-container";

import { MainWindowManager } from "./main-window-manager";

test("native Main close disposes its scope and the next open recreates it", async () => {
  const process = createDesktopProcessContainer();
  const ids: number[] = [];
  let nextId = 0;
  const manager = new MainWindowManager(process, (scope) => {
    const id = ++nextId;
    ids.push(id);
    const listeners = new Set<() => void>();
    scope.onDispose(() => undefined);
    return Promise.resolve({
      id,
      activate: () => undefined,
      closeNative: () => {
        listeners.forEach((listener) => listener());
        void scope.dispose();
      },
    });
  });

  const first = await manager.open();
  expect(first.id).toBe(1);
  first.closeNative();
  await Bun.sleep(0);
  expect(manager.current()).toBeUndefined();
  expect((await manager.open()).id).toBe(2);
  expect(ids).toEqual([1, 2]);

  await process.dispose();
});

test("concurrent Main opens share creation and activate the result", async () => {
  const process = createDesktopProcessContainer();
  let createCount = 0;
  let activations = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const manager = new MainWindowManager(process, async () => {
    createCount += 1;
    await gate;
    return {
      activate: () => {
        activations += 1;
      },
    };
  });

  const first = manager.open();
  const second = manager.open();
  finish();
  expect(await first).toBe(await second);
  expect(createCount).toBe(1);
  expect(activations).toBe(1);

  await process.dispose();
});

test("a Main closed during async creation is never retained", async () => {
  const process = createDesktopProcessContainer();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const manager = new MainWindowManager(process, async (scope) => {
    await gate;
    await scope.dispose();
    return { activate: () => undefined };
  });

  const opening = manager.open();
  finish();

  expect(opening).rejects.toThrow("Main window closed during creation.");
  await opening.catch(() => undefined);
  expect(manager.current()).toBeUndefined();
  await process.dispose();
});
