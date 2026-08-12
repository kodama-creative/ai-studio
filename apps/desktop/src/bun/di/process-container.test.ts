import { expect, test } from "bun:test";

import { createDesktopProcessContainer } from "./process-container";

test("window scopes inherit process services and dispose only their own resources", async () => {
  const events: string[] = [];
  const process = createDesktopProcessContainer();
  const sharedToken = Symbol.for("test.shared");
  const windowToken = Symbol.for("test.window");
  const shared = { name: "models" };
  process.bindConstant(sharedToken, shared);
  process.onDispose(() => {
    events.push("process");
  });

  const main = process.createWindowScope("main");
  const project = process.createWindowScope("project:alpha");
  main.bindConstant(windowToken, { name: "main" });
  project.bindConstant(windowToken, { name: "project" });
  project.onDispose(() => {
    events.push("project:last");
  });
  project.onDispose(() => {
    events.push("project:first");
  });

  expect(main.get<{ name: string }>(sharedToken)).toBe(shared);
  expect(project.get<{ name: string }>(sharedToken)).toBe(shared);
  expect(main.get<{ name: string }>(windowToken).name).toBe("main");
  expect(project.get<{ name: string }>(windowToken).name).toBe("project");

  await project.dispose();

  expect(events).toEqual(["project:first", "project:last"]);
  expect(main.get<{ name: string }>(sharedToken)).toBe(shared);

  await process.dispose();

  expect(events).toEqual(["project:first", "project:last", "process"]);
});

test("process disposal closes remaining window scopes before shared services", async () => {
  const events: string[] = [];
  const process = createDesktopProcessContainer();
  const window = process.createWindowScope("main");
  process.onDispose(() => {
    events.push("process");
  });
  window.onDispose(() => {
    events.push("window");
  });

  await process.dispose();

  expect(events).toEqual(["window", "process"]);
  expect(() => process.createWindowScope("late")).toThrow(
    "Desktop process scope is disposed."
  );
});
