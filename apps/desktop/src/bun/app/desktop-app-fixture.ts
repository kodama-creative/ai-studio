import { mock } from "bun:test";

const events: string[] = [];

await mock.module("electrobun/bun", () => ({
  ApplicationMenu: {},
  BrowserWindow: class {},
  Updater: {},
}));

const { DesktopApp } = await import("./desktop-app");

/** Create an isolated app with a selectable Project restore outcome. */
function createApp(restoreProjects: () => Promise<void>) {
  return new DesktopApp(
    {
      applyToProcessEnvironment: () => events.push("network:apply"),
    } as never,
    {
      isFirstRun: true,
      capture: () => events.push("analytics:capture"),
    } as never,
    { start: () => events.push("updater:start") } as never,
    { dispose: () => Promise.resolve() } as never,
    {
      start: () => {
        events.push("launch:start");
        return Promise.resolve();
      },
      dispose: () => events.push("launch:dispose"),
    } as never,
    {
      close: () => {
        events.push("main:close");
        return Promise.resolve();
      },
    } as never,
    {
      restoreProjects,
      closeAll: () => {
        events.push("projects:close");
        return Promise.resolve();
      },
    } as never,
    {} as never
  );
}

const app = createApp(() => {
  events.push("projects:restore");
  return Promise.resolve();
});
await app.start();
await app.stop();
await app.stop();

assertLifecycle(events, "DesktopApp lifecycle");

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

assertLifecycle(events, "failed DesktopApp cleanup");

/** Assert the business phases while allowing sibling windows to close in parallel. */
function assertLifecycle(actual: readonly string[], label: string): void {
  const startup = [
    "network:apply",
    "launch:start",
    "analytics:capture",
    "updater:start",
    "projects:restore",
    "launch:dispose",
  ];
  if (JSON.stringify(actual.slice(0, startup.length)) !== JSON.stringify(startup)) {
    throw new Error(`Unexpected ${label}: ${actual.join(", ")}`);
  }
  const windowStops = actual.slice(startup.length).sort();
  if (
    JSON.stringify(windowStops) !==
    JSON.stringify(["main:close", "projects:close"])
  ) {
    throw new Error(`Unexpected ${label}: ${actual.join(", ")}`);
  }
}
