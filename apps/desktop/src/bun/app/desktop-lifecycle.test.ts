import { expect, test } from "bun:test";

import { DesktopLifecycle } from "./desktop-lifecycle";

test("DesktopLifecycle stops resources once in reverse ownership order", async () => {
  const calls: string[] = [];
  const lifecycle = new DesktopLifecycle();
  lifecycle.defer("first", () => {
    calls.push("first");
  });
  lifecycle.defer("second", () =>
    Promise.resolve().then(() => {
      calls.push("second");
    })
  );

  await Promise.all([lifecycle.stop(), lifecycle.stop()]);

  expect(calls).toEqual(["second", "first"]);
  expect(() => lifecycle.defer("late", () => undefined)).toThrow(
    "already stopping"
  );
});

test("DesktopLifecycle reports one failure and continues cleanup", async () => {
  const calls: string[] = [];
  const errors: { name: string; error: unknown }[] = [];
  const failure = new Error("broken");
  const lifecycle = new DesktopLifecycle((name, error) =>
    errors.push({ name, error })
  );
  lifecycle.defer("last", () => {
    calls.push("last");
  });
  lifecycle.defer("broken owner", () => {
    throw failure;
  });
  lifecycle.defer("first", () => {
    calls.push("first");
  });

  await lifecycle.stop();

  expect(calls).toEqual(["first", "last"]);
  expect(errors).toEqual([{ name: "broken owner", error: failure }]);
});
