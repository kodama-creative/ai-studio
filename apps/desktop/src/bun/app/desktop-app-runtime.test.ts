import { expect, test } from "bun:test";

import { DesktopAppRuntime } from "./desktop-app-runtime";

test("DesktopAppRuntime stops top-level owners once in declared order", async () => {
  const stopped: string[] = [];
  const runtime = new DesktopAppRuntime([
    { name: "links", stop: () => void stopped.push("links") },
    { name: "windows", stop: () => void stopped.push("windows") },
    { name: "process", stop: () => void stopped.push("process") },
  ]);

  await Promise.all([runtime.stop(), runtime.stop()]);

  expect(stopped).toEqual(["links", "windows", "process"]);
});

test("DesktopAppRuntime reports one failure and continues shutdown", async () => {
  const stopped: string[] = [];
  const errors: { name: string; error: unknown }[] = [];
  const failure = new Error("failed");
  const runtime = new DesktopAppRuntime(
    [
      { name: "broken", stop: () => Promise.reject(failure) },
      { name: "remaining", stop: () => void stopped.push("remaining") },
    ],
    (name, error) => errors.push({ name, error })
  );

  await runtime.stop();

  expect(stopped).toEqual(["remaining"]);
  expect(errors).toEqual([{ name: "broken", error: failure }]);
});
