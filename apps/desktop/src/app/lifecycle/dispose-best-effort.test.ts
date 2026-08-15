import { describe, expect, test } from "bun:test";

import { disposeBestEffort } from "./dispose-best-effort";

describe("disposeBestEffort", () => {
  test("contains synchronous and asynchronous cleanup failures", async () => {
    let calls = 0;

    disposeBestEffort({
      dispose: () => {
        calls += 1;
        throw new Error("sync cleanup failed");
      },
    });
    disposeBestEffort({
      dispose: () => {
        calls += 1;
        return Promise.reject(new Error("async cleanup failed"));
      },
    });
    disposeBestEffort(null);
    await _flushMicrotasks();

    expect(calls).toBe(2);
  });
});

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
