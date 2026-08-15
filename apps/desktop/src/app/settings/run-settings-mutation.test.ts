import { describe, expect, test } from "bun:test";

import { runSettingsMutation } from "./run-settings-mutation";

describe("runSettingsMutation", () => {
  test("routes success through the UI callback", async () => {
    const values: string[] = [];
    runSettingsMutation(() => Promise.resolve("saved"), {
      onSuccess: (value) => values.push(value),
      onError: () => values.push("error"),
    });

    await _flushMicrotasks();
    expect(values).toEqual(["saved"]);
  });

  test("contains synchronous mutation throws and rejected Promises", async () => {
    const errors: unknown[] = [];
    runSettingsMutation(
      () => {
        throw new Error("sync RPC setup failed");
      },
      { onError: (error) => errors.push(error) }
    );
    runSettingsMutation(() => Promise.reject(new Error("RPC failed")), {
      onError: (error) => errors.push(error),
    });

    await _flushMicrotasks();
    expect(errors.map(String)).toEqual([
      "Error: sync RPC setup failed",
      "Error: RPC failed",
    ]);
  });

  test("contains a failing error presenter", async () => {
    runSettingsMutation(() => Promise.reject(new Error("RPC failed")), {
      onError: () => {
        throw new Error("toast failed");
      },
    });

    await _flushMicrotasks();
    expect(true).toBe(true);
  });
});

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
