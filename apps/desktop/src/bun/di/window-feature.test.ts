import { expect, test } from "bun:test";

import { ContainerModule } from "inversify";

import { createDesktopProcessContainer } from "./process-container";
import type { DesktopWindowScope } from "./process-container";
import {
  bindWindowFeature,
  DesktopWindowFeatures,
  WindowFeature,
  windowFeature,
} from "./window-feature";

const SCOPE = {} as DesktopWindowScope;
const CONTEXT = {
  kind: "main" as const,
  commandSink: { sendToWebview: () => undefined },
};

test("window features install once in DI registration order", () => {
  const installed: string[] = [];
  const features = new DesktopWindowFeatures([
    windowFeature("first", () => installed.push("first")),
    windowFeature("second", () => installed.push("second")),
  ]);

  features.install(SCOPE, CONTEXT);

  expect(installed).toEqual(["first", "second"]);
  expect(() => features.install(SCOPE, CONTEXT)).toThrow(
    "Desktop window features are already installed."
  );
});

test("window features reject duplicate ownership before the duplicate installs", () => {
  const installed: string[] = [];
  const features = new DesktopWindowFeatures([
    windowFeature("same", () => installed.push("first")),
    windowFeature("same", () => installed.push("second")),
  ]);

  expect(() => features.install(SCOPE, CONTEXT)).toThrow(
    'Duplicate desktop window feature id "same".'
  );
  expect(installed).toEqual([]);
});

test("window feature startup errors identify their owner", () => {
  const failure = new Error("boom");
  const features = new DesktopWindowFeatures([
    windowFeature("broken", () => {
      throw failure;
    }),
  ]);

  try {
    features.install(SCOPE, CONTEXT);
    throw new Error("Expected feature installation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Failed to install desktop window feature "broken".'
    );
    expect((error as Error).cause).toBe(failure);
  }
});

test("window scopes inherit the ordered process feature multi-binding", async () => {
  const installed: string[] = [];
  const process = createDesktopProcessContainer();
  process.load(
    new ContainerModule(({ bind }) => {
      bindWindowFeature(
        bind,
        windowFeature("first", () => installed.push("first"))
      );
      bindWindowFeature(
        bind,
        windowFeature("second", () => installed.push("second"))
      );
    })
  );
  const scope = process.createWindowScope("main");

  new DesktopWindowFeatures(scope.getAll(WindowFeature)).install(
    scope,
    CONTEXT
  );

  expect(installed).toEqual(["first", "second"]);
  await process.dispose();
});
