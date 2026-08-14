import {
  DEFAULT_WINDOW_FRAME,
  getWindowFrame,
  getWindowFullScreen,
  getWindowMaximized,
  getWindowZoom,
  WindowStateStore,
} from "@llm-space/core/server";
import { BrowserWindow, Updater } from "electrobun/bun";

import type { AgentProjectView } from "../../shared/agent-project";
import type { MainWindowRPC } from "../rpc";

import type {
  WindowStateManager,
  WindowStatePersistenceStore,
} from "./window-state";

const DEV_SERVER_PORT = Number(
  process.env.LLM_SPACE_DESKTOP_DEV_SERVER_PORT ?? 5173
);
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function _getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.info(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.info(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support."
      );
    }
  }
  return "views://mainview/index.html";
}

export async function createMainWindow({
  rpc,
  windowStates,
  onFullScreenChange,
}: {
  rpc: MainWindowRPC;
  windowStates: WindowStateManager;
  onFullScreenChange?: (fullScreen: boolean) => void;
}): Promise<BrowserWindow> {
  const url = await _getMainViewUrl();
  const windowStateStore = await WindowStateStore.load();
  const windowState = windowStateStore.state;
  const savedFrame = getWindowFrame(windowState) ?? DEFAULT_WINDOW_FRAME;
  const savedZoom = getWindowZoom(windowState) ?? 1;

  const window = new BrowserWindow({
    title: "LLM Space",
    url,
    titleBarStyle: "hiddenInset",
    rpc,
    trafficLightOffset: {
      x: 2,
      y: 16,
    },
    frame: savedFrame,
  });

  windowStates.attach(window, {
    store: windowStateStore,
    isMaximized: getWindowMaximized(windowState),
    isFullScreen: getWindowFullScreen(windowState),
    zoom: savedZoom,
    onFullScreenChange: (fullScreen) => {
      onFullScreenChange?.(fullScreen);
    },
  });
  return window;
}

export async function createAgentProjectWindow({
  rpc,
  project,
  stateStore,
  windowStates,
  onFullScreenChange,
}: {
  rpc: MainWindowRPC;
  project: AgentProjectView;
  stateStore: WindowStatePersistenceStore;
  windowStates: WindowStateManager;
  onFullScreenChange?: (fullScreen: boolean) => void;
}): Promise<BrowserWindow> {
  const state = stateStore.state;
  const baseUrl = await _getMainViewUrl();
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}window=agent-project&project=${encodeURIComponent(project.id)}`;
  const window = new BrowserWindow({
    title: `${project.name} — LLM Space`,
    url,
    titleBarStyle: "hiddenInset",
    rpc,
    trafficLightOffset: { x: 2, y: 16 },
    frame: getWindowFrame(state) ?? {
      ...DEFAULT_WINDOW_FRAME,
      x: DEFAULT_WINDOW_FRAME.x + 32,
      y: DEFAULT_WINDOW_FRAME.y + 32,
    },
  });
  windowStates.attach(window, {
    store: stateStore,
    isMaximized: getWindowMaximized(state),
    isFullScreen: getWindowFullScreen(state),
    zoom: getWindowZoom(state) ?? 1,
    onFullScreenChange: (fullScreen) => {
      onFullScreenChange?.(fullScreen);
    },
  });
  return window;
}
