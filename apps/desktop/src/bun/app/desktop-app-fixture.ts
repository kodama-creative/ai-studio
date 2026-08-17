import { mock } from "bun:test";

const events: string[] = [];

await mock.module("electrobun/bun", () => ({
  default: {
    events: {
      on: (name: string) => events.push(`event:${name}`),
    },
  },
  app: { quit: () => events.push("app:quit") },
}));
await mock.module("./menu", () => ({
  registerMenuActions: () => events.push("menu:register"),
}));
await mock.module("./shutdown-coordinator", () => ({
  createShutdownCoordinator: () => () => undefined,
}));

const { DesktopApp } = await import("./desktop-app");

/** Create an isolated app with a selectable Project restore outcome. */
function createApp(restoreProjects: () => Promise<void>) {
  return new DesktopApp({
    analytics: {
      isFirstRun: true,
      capture: () => events.push("analytics:capture"),
    } as never,
    updater: { start: () => events.push("updater:start") } as never,
    launch: {
      start: () => {
        events.push("launch:start");
        return Promise.resolve();
      },
      reopen: () => events.push("launch:reopen"),
      dispose: () => events.push("launch:dispose"),
    } as never,
    mainWindows: { current: () => undefined } as never,
    projectWindows: {
      restoreProjects,
      closeAll: () => {
        events.push("projects:close");
        return Promise.resolve();
      },
    } as never,
    windowFactory: {} as never,
    stopProcess: () => {
      events.push("process:stop");
      return Promise.resolve();
    },
  });
}

const app = createApp(() => {
  events.push("projects:restore");
  return Promise.resolve();
});
await app.start();
await app.stop();
await app.stop();

const expected = [
  "menu:register",
  "launch:start",
  "analytics:capture",
  "updater:start",
  "projects:restore",
  "event:before-quit",
  "event:reopen",
  "launch:dispose",
  "projects:close",
  "process:stop",
];
if (JSON.stringify(events) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected DesktopApp lifecycle: ${events.join(", ")}`);
}

try {
  await app.start();
  throw new Error("DesktopApp unexpectedly started twice.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Desktop application is already started."
  ) {
    throw error;
  }
}

events.length = 0;
const failedApp = createApp(() => {
  events.push("projects:restore");
  return Promise.reject(new Error("restore failed"));
});
try {
  await failedApp.start();
  throw new Error("DesktopApp unexpectedly survived a restore failure.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "restore failed") {
    throw error;
  }
}
await failedApp.stop();

const failureExpected = [
  "menu:register",
  "launch:start",
  "analytics:capture",
  "updater:start",
  "projects:restore",
  "launch:dispose",
  "projects:close",
  "process:stop",
];
if (JSON.stringify(events) !== JSON.stringify(failureExpected)) {
  throw new Error(`Unexpected failed DesktopApp cleanup: ${events.join(", ")}`);
}
