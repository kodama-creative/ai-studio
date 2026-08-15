import { expect, test } from "bun:test";

import { trackAnalytics } from "./analytics";

const EVENT = { event: "settings_opened" as const, properties: {} };

test("renderer analytics contains synchronous and asynchronous RPC failures", async () => {
  let calls = 0;
  trackAnalytics(
    {
      capture: () => {
        calls += 1;
        throw new Error("sync failure");
      },
    },
    EVENT
  );
  trackAnalytics(
    {
      capture: () => {
        calls += 1;
        return Promise.reject(new Error("async failure"));
      },
    },
    EVENT
  );

  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toBe(2);
});
