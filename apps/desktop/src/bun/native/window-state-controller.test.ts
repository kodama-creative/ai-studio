import { expect, test } from "bun:test";

import type { BrowserWindow } from "electrobun/bun";

import { WindowStateController } from "./window-state-controller";

test("native window events stop admitting state writes during disposal", async () => {
  const listeners = new Map<string, (() => void)[]>();
  let domReady: (() => void) | undefined;
  let fullScreen = false;
  let zoom = 1;
  const window = {
    getFrame: () => ({ x: 10, y: 20, width: 800, height: 600 }),
    getPageZoom: () => zoom,
    isFullScreen: () => fullScreen,
    isMaximized: () => false,
    maximize: () => undefined,
    setFullScreen: () => undefined,
    setPageZoom: (next: number) => {
      zoom = next;
    },
    on: (event: string, listener: () => void) => {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
    },
    webview: {
      on: (_event: string, listener: () => void) => {
        domReady = listener;
      },
    },
  } as unknown as BrowserWindow;
  const updates: unknown[] = [];
  const fullScreenEvents: boolean[] = [];
  let flushes = 0;
  const controller = new WindowStateController();
  controller.onDidChangeFullScreen((value) => fullScreenEvents.push(value));
  controller.attach(
    window,
    {
      state: {},
      update: (patch) => {
        updates.push(patch);
        return Promise.resolve();
      },
      flush: () => {
        flushes += 1;
        return Promise.resolve();
      },
    },
    { zoom: 1 }
  );
  fullScreen = true;
  for (const listener of listeners.get("resize") ?? []) listener();
  fullScreen = false;

  await controller.dispose();
  controller.saveZoom(1.5);
  for (const listener of listeners.get("move") ?? []) listener();
  for (const listener of listeners.get("resize") ?? []) listener();
  domReady?.();
  await Bun.sleep(350);

  expect(updates).toEqual([
    {
      frame: { x: 10, y: 20, width: 800, height: 600 },
      isMaximized: false,
      isFullScreen: false,
    },
    { zoom: 1 },
  ]);
  expect(flushes).toBe(1);
  expect(zoom).toBe(1);
  expect(fullScreenEvents).toEqual([false, true]);
});

test("renderer close preserves the last frame when CEF reports 0x0", async () => {
  const updates: unknown[] = [];
  let flushes = 0;
  const controller = new WindowStateController();
  controller.attach(
    {
      getFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      getPageZoom: () => 1,
      isFullScreen: () => false,
      isMaximized: () => false,
      on: () => undefined,
      webview: { on: () => undefined },
    } as unknown as BrowserWindow,
    {
      state: { frame: { x: 10, y: 20, width: 800, height: 600 } },
      update: (patch) => {
        updates.push(patch);
        return Promise.resolve();
      },
      flush: () => {
        flushes += 1;
        return Promise.resolve();
      },
    },
    { zoom: 1 }
  );

  await controller.dispose();

  expect(updates).toEqual([{ zoom: 1 }]);
  expect(flushes).toBe(1);
});
