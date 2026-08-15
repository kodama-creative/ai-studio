import { expect, test } from "bun:test";

import type { BrowserWindow } from "electrobun/bun";

import type { WindowStateManager } from "../app/window-state";

import { WindowApplication } from "./native-window-module";

const STATE_BINDING = {
  store: {
    state: {},
    update: () => Promise.resolve(),
    flush: () => Promise.resolve(),
  },
};

test("WindowApplication requires exactly one attached native window", async () => {
  const window = {
    isFullScreen: () => false,
  } as BrowserWindow;
  const application = new WindowApplication(
    { kind: "playground" },
    { attach: () => undefined } as unknown as WindowStateManager
  );

  expect(() => application.getFullscreenState()).toThrow(
    "Native window is not attached."
  );

  application.attach(window, STATE_BINDING);

  expect(await application.getContext()).toEqual({ kind: "playground" });
  expect(await application.getFullscreenState()).toEqual({
    fullScreen: false,
  });
  expect(() => application.attach(window, STATE_BINDING)).toThrow(
    "Native window is already attached."
  );
});

test("WindowApplication owns native window commands and zoom persistence", () => {
  let maximized = false;
  let zoom = 1;
  const scripts: string[] = [];
  const savedZooms: number[] = [];
  const window = {
    id: 7,
    isMaximized: () => maximized,
    maximize: () => {
      maximized = true;
    },
    unmaximize: () => {
      maximized = false;
    },
    getPageZoom: () => zoom,
    setPageZoom: (next: number) => {
      zoom = next;
    },
    webview: {
      executeJavascript: (script: string) => {
        scripts.push(script);
      },
    },
  } as unknown as BrowserWindow;
  const windowStates = {
    attach: () => undefined,
    saveZoom: (target: BrowserWindow, next: number) => {
      expect(target).toBe(window);
      savedZooms.push(next);
    },
  } as unknown as WindowStateManager;
  const application = new WindowApplication(
    { kind: "playground" },
    windowStates
  );
  application.attach(window, STATE_BINDING);

  application.toggleMaximized();
  expect(maximized).toBe(true);
  application.toggleMaximized();
  expect(maximized).toBe(false);

  application.zoomIn();
  application.zoomOut();
  application.resetZoom();
  application.reload();

  expect(savedZooms).toEqual([1.1, 1, 1]);
  expect(zoom).toBe(1);
  expect(scripts).toEqual(["location.reload()"]);
});

test("WindowApplication owns window-state attachment and fullscreen events", () => {
  const window = { id: 11 } as BrowserWindow;
  const store = STATE_BINDING.store;
  let attached:
    | {
        target: BrowserWindow;
        options: Parameters<WindowStateManager["attach"]>[1];
      }
    | undefined;
  const windowStates = {
    attach: (
      target: BrowserWindow,
      options: Parameters<WindowStateManager["attach"]>[1]
    ) => {
      attached = { target, options };
    },
  } as WindowStateManager;
  const application = new WindowApplication(
    { kind: "playground" },
    windowStates
  );
  const fullScreenEvents: boolean[] = [];
  application.events.subscribe("fullScreenChanged", ({ fullScreen }) => {
    fullScreenEvents.push(fullScreen);
  });

  application.attach(window, {
    store,
    isMaximized: true,
    isFullScreen: false,
    zoom: 1.25,
  });

  expect(attached?.target).toBe(window);
  expect(attached?.options).toMatchObject({
    store,
    isMaximized: true,
    isFullScreen: false,
    zoom: 1.25,
  });
  attached?.options.onFullScreenChange(true);
  expect(fullScreenEvents).toEqual([true]);
});

test("WindowApplication remains unattached when window-state attachment fails", async () => {
  const window = { isFullScreen: () => true } as BrowserWindow;
  let attempts = 0;
  const windowStates = {
    attach: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("state attach failed");
    },
  } as unknown as WindowStateManager;
  const application = new WindowApplication(
    { kind: "playground" },
    windowStates
  );

  expect(() => application.attach(window, STATE_BINDING)).toThrow(
    "state attach failed"
  );
  expect(() => application.getFullscreenState()).toThrow(
    "Native window is not attached."
  );

  application.attach(window, STATE_BINDING);
  expect(await application.getFullscreenState()).toEqual({ fullScreen: true });
});
