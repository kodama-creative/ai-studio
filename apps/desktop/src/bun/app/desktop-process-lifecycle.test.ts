import { expect, spyOn, test } from "bun:test";

import { DesktopProcessLifecycle } from "./desktop-process-lifecycle";

test("process lifecycle cleans resources once in reverse construction order", async () => {
  const calls: string[] = [];
  const lifecycle = new DesktopProcessLifecycle();
  lifecycle.defer("first", () => {
    calls.push("first");
  });
  lifecycle.defer("second", () =>
    Promise.resolve().then(() => {
      calls.push("second");
    })
  );

  await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);

  expect(calls).toEqual(["second", "first"]);
  expect(() => lifecycle.defer("late", () => undefined)).toThrow(
    "already disposing"
  );
});

test("process lifecycle reports one failure and continues cleanup", async () => {
  const calls: string[] = [];
  const failure = new Error("broken");
  const error = spyOn(console, "error").mockImplementation(() => undefined);
  const lifecycle = new DesktopProcessLifecycle();
  lifecycle.defer("last", () => {
    calls.push("last");
  });
  lifecycle.defer("broken owner", () => {
    throw failure;
  });
  lifecycle.defer("first", () => {
    calls.push("first");
  });

  await lifecycle.dispose();

  expect(calls).toEqual(["first", "last"]);
  expect(error).toHaveBeenCalledWith("Failed to stop broken owner:", failure);
  error.mockRestore();
});
