import { describe, expect, test } from "bun:test";

import type { Disposable } from "@/shared/disposable";

import {
  FullScreenController,
  type FullScreenClient,
} from "./full-screen-controller";

describe("FullScreenController", () => {
  test("subscribes before reading and keeps a live event authoritative", async () => {
    const read = _deferred<{ fullScreen: boolean }>();
    const order: string[] = [];
    let listener: ((payload: { fullScreen: boolean }) => void) | undefined;
    const controller = new FullScreenController({
      getFullscreenState: () => {
        order.push("read");
        return read.promise;
      },
      on: (_event, nextListener) => {
        order.push("subscribe");
        listener = nextListener;
        return NOOP_DISPOSABLE;
      },
    });

    controller.start();
    await Promise.resolve();
    expect(order).toEqual(["subscribe", "read"]);
    listener?.({ fullScreen: true });
    read.resolve({ fullScreen: false });
    await read.promise;
    await Promise.resolve();

    expect(controller.getSnapshot()).toEqual({ fullScreen: true });
  });

  test("invalidates a retained listener and read across restart", async () => {
    const oldRead = _deferred<{ fullScreen: boolean }>();
    const newRead = _deferred<{ fullScreen: boolean }>();
    const listeners: ((payload: { fullScreen: boolean }) => void)[] = [];
    let reads = 0;
    let disposals = 0;
    const controller = new FullScreenController({
      getFullscreenState: () => {
        reads += 1;
        return reads === 1 ? oldRead.promise : newRead.promise;
      },
      on: (_event, listener) => {
        listeners.push(listener);
        return { dispose: () => void (disposals += 1) };
      },
    });

    controller.start();
    await Promise.resolve();
    controller.stop();
    controller.start();
    await Promise.resolve();
    listeners[0]?.({ fullScreen: true });
    oldRead.resolve({ fullScreen: true });
    newRead.resolve({ fullScreen: false });
    await Promise.all([oldRead.promise, newRead.promise]);
    await Promise.resolve();

    expect(disposals).toBe(1);
    expect(controller.getSnapshot()).toEqual({ fullScreen: false });
    listeners[1]?.({ fullScreen: true });
    expect(controller.getSnapshot()).toEqual({ fullScreen: true });
  });

  test("contains subscription, read, and disposal failures", async () => {
    let reads = 0;
    const client: FullScreenClient = {
      getFullscreenState: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve({ fullScreen: true })
          : Promise.reject(new Error("read failed"));
      },
      on: () => {
        if (reads === 0) throw new Error("subscribe failed");
        return { dispose: () => Promise.reject(new Error("dispose failed")) };
      },
    };
    const controller = new FullScreenController(client);

    expect(() => controller.start()).not.toThrow();
    await _eventually(() => controller.getSnapshot().fullScreen, true);
    controller.stop();
    expect(() => controller.start()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot()).toEqual({ fullScreen: true });
    expect(() => controller.stop()).not.toThrow();
  });
});

const NOOP_DISPOSABLE: Disposable = { dispose: () => undefined };

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
