const events: string[] = [];

const { DesktopApp } = await import("./desktop-app");

/** Create an isolated app with a selectable Project restore outcome. */
function createApp(restoreProjects: () => Promise<void>) {
  return new DesktopApp(
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

const expected = [
  "launch:start",
  "analytics:capture",
  "updater:start",
  "projects:restore",
  "launch:dispose",
  "projects:close",
  "main:close",
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
  "launch:start",
  "analytics:capture",
  "updater:start",
  "projects:restore",
  "launch:dispose",
  "projects:close",
  "main:close",
];
if (JSON.stringify(events) !== JSON.stringify(failureExpected)) {
  throw new Error(`Unexpected failed DesktopApp cleanup: ${events.join(", ")}`);
}
