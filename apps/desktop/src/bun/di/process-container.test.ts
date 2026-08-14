import { expect, test } from "bun:test";

import { ContainerModule } from "inversify";

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

test("scopes automatically dispose resolved resources once in reverse order", async () => {
  const events: string[] = [];
  const process = createDesktopProcessContainer();
  const firstToken = Symbol.for("test.disposable.first");
  const secondToken = Symbol.for("test.disposable.second");
  const first = {
    dispose: () => {
      events.push("first");
    },
  };
  const second = {
    dispose: () => {
      events.push("second");
    },
  };
  process.bindConstant(firstToken, first);
  process.bindConstant(secondToken, second);

  expect(process.get<typeof first>(firstToken)).toBe(first);
  expect(process.get<typeof first>(firstToken)).toBe(first);
  await process.dispose();

  expect(events).toEqual(["second", "first"]);
});

test("a process singleton first resolved by a window remains process-owned", async () => {
  const events: string[] = [];
  const process = createDesktopProcessContainer();
  const token = Symbol.for("test.disposable.inherited");
  process.load(
    new ContainerModule(({ bind }) => {
      bind(token)
        .toDynamicValue(() => ({ dispose: () => events.push("process") }))
        .inSingletonScope();
    })
  );
  const window = process.createWindowScope("main");

  window.get(token);
  await window.dispose();
  expect(events).toEqual([]);

  await process.dispose();
  expect(events).toEqual(["process"]);
});
