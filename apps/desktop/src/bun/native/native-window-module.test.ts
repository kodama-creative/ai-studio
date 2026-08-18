import { expect, test } from "bun:test";

import type { BrowserWindow } from "electrobun/bun";

import { WindowApplication } from "./native-window-module";
import type { WindowStateController } from "./window-state-controller";

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
    { getWindowContext: () => ({ kind: "playground" }) },
    {
      attach: () => undefined,
      onDidChangeFullScreen: _emptyEvent,
    } as unknown as WindowStateController
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

test("WindowApplication owns native window commands and zoom persistence", async () => {
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
    onDidChangeFullScreen: _emptyEvent,
    saveZoom: (next: number) => {
      savedZooms.push(next);
    },
  } as unknown as WindowStateController;
  const application = new WindowApplication(
    { getWindowContext: () => ({ kind: "playground" }) },
    windowStates
  );
  application.attach(window, STATE_BINDING);

  await application.toggleMaximized();
  expect(maximized).toBe(true);
  await application.toggleMaximized();
  expect(maximized).toBe(false);

  await application.zoomIn();
  await application.zoomOut();
  await application.resetZoom();
  await application.reload();

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
        store: Parameters<WindowStateController["attach"]>[1];
        options: Parameters<WindowStateController["attach"]>[2];
      }
    | undefined;
  let notifyFullScreen: ((fullScreen: boolean) => void) | undefined;
  const windowStates = {
    onDidChangeFullScreen: (listener: (fullScreen: boolean) => void) => {
      notifyFullScreen = listener;
      return { dispose: () => undefined };
    },
    attach: (
      target: BrowserWindow,
      attachedStore: Parameters<WindowStateController["attach"]>[1],
      options: Parameters<WindowStateController["attach"]>[2]
    ) => {
      attached = { target, store: attachedStore, options };
    },
  } as WindowStateController;
  const application = new WindowApplication(
    { getWindowContext: () => ({ kind: "playground" }) },
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
  expect(attached?.store).toBe(store);
  expect(attached?.options).toMatchObject({
    isMaximized: true,
    isFullScreen: false,
    zoom: 1.25,
  });
  notifyFullScreen?.(true);
  expect(fullScreenEvents).toEqual([true]);
});

test("WindowApplication remains unattached when window-state attachment fails", async () => {
  const window = { isFullScreen: () => true } as BrowserWindow;
  let attempts = 0;
  const windowStates = {
    onDidChangeFullScreen: _emptyEvent,
    attach: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("state attach failed");
    },
  } as unknown as WindowStateController;
  const application = new WindowApplication(
    { getWindowContext: () => ({ kind: "playground" }) },
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

function _emptyEvent(): { dispose(): void } {
  return { dispose: () => undefined };
}
