import { describe, expect, test } from "bun:test";

import { SerializedPersistence } from "./serialized-persistence";

function _deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("SerializedPersistence", () => {
  test("terminal writes wait behind older debounced writes", async () => {
    const firstWrite = _deferred();
    const secondWrite = _deferred();
    const started: string[] = [];
    const finished: string[] = [];
    const persistence = new SerializedPersistence<string>(async (value) => {
      started.push(value);
      await (value === "A" ? firstWrite.promise : secondWrite.promise);
      finished.push(value);
    });

    persistence.setPending("A");
    const debounceFlush = persistence.flush();
    await Promise.resolve();
    expect(started).toEqual(["A"]);

    persistence.setPending("B");
    const terminalFlush = persistence.flush();
    await Promise.resolve();
    expect(started).toEqual(["A"]);

    firstWrite.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["A", "B"]);
    expect(finished).toEqual(["A"]);

    secondWrite.resolve();
    await Promise.all([debounceFlush, terminalFlush]);
    expect(finished).toEqual(["A", "B"]);
  });

  test("a failed debounce retries the newest terminal value without another flush", async () => {
    const firstWrite = _deferred();
    const retry = _deferred();
    const writes: string[] = [];
    const persistence = new SerializedPersistence<string>(
      async (value) => {
        writes.push(value);
        if (writes.length === 1) await firstWrite.promise;
      },
      { waitBeforeRetry: () => retry.promise }
    );

    persistence.setPending("A");
    const debounceFlush = persistence.flush();
    await Promise.resolve();
    persistence.setPending("B");
    const terminalFlush = persistence.flush();
    firstWrite.reject(new Error("disk full"));
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toEqual(["A"]);

    retry.resolve();
    await Promise.all([debounceFlush, terminalFlush]);

    expect(writes).toEqual(["A", "B"]);
  });

  test("keeps a Draft queued while its operation owns the document", async () => {
    let writable = false;
    const writes: string[] = [];
    const busy: boolean[] = [];
    const persistence = new SerializedPersistence<string>(
      (value) => {
        writes.push(value);
        return Promise.resolve();
      },
      {
        canWrite: () => writable,
        onBusyChange: (value) => busy.push(value),
      }
    );

    persistence.setPending("between-step edit");
    await persistence.flush();

    expect(writes).toEqual([]);
    expect(busy).toEqual([true]);

    writable = true;
    await persistence.flush();

    expect(writes).toEqual(["between-step edit"]);
    expect(busy).toEqual([true, false]);
  });

  test("stops retrying when the document becomes read-only", async () => {
    let writable = true;
    let attempts = 0;
    const persistence = new SerializedPersistence<string>(
      () => {
        attempts += 1;
        if (attempts === 1) {
          writable = false;
          return Promise.reject(new Error("operation admitted during write"));
        }
        return Promise.resolve();
      },
      {
        canWrite: () => writable,
        waitBeforeRetry: () => Promise.resolve(),
      }
    );

    persistence.setPending("draft");
    await persistence.flush();
    expect(attempts).toBe(1);

    writable = true;
    await persistence.flush();
    expect(attempts).toBe(2);
  });
});
