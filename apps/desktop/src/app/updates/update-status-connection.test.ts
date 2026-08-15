import { describe, expect, test } from "bun:test";

import type { UpdateStatusChangedPayload } from "@/shared/updates";

import { UpdateStatusConnection } from "./update-status-connection";

const STATUS: UpdateStatusChangedPayload = {
  manual: false,
  status: { state: "up-to-date", version: "1.2.3" },
};

describe("UpdateStatusConnection", () => {
  test("subscribes before the installed-version read and forwards both", async () => {
    const calls: string[] = [];
    let publish!: (payload: UpdateStatusChangedPayload) => void;
    const connection = new UpdateStatusConnection({
      subscribeStatus: (listener) => {
        calls.push("subscribe");
        publish = listener;
        return { dispose: () => undefined };
      },
      takeInstalledVersion: () => {
        calls.push("read");
        return Promise.resolve("1.2.3");
      },
      onStatus: () => calls.push("status"),
      onInstalledVersion: (version) => calls.push(`installed:${version}`),
    });

    connection.start();
    publish(STATUS);
    await _flushMicrotasks();

    expect(calls).toEqual([
      "subscribe",
      "read",
      "status",
      "installed:1.2.3",
    ]);
    connection.stop();
  });

  test("contains rejected reads and synchronous or async disposal failures", async () => {
    let subscription = 0;
    const connection = new UpdateStatusConnection({
      subscribeStatus: () => ({
        dispose: () => {
          subscription += 1;
          return Promise.reject(new Error("listener already removed"));
        },
      }),
      takeInstalledVersion: () =>
        Promise.reject(new Error("RPC window already closed")),
      onStatus: () => undefined,
      onInstalledVersion: () => undefined,
    });

    connection.start();
    connection.stop();
    await _flushMicrotasks();

    expect(subscription).toBe(1);
  });

  test("ignores reads and events after stop", async () => {
    let resolve!: (version: string | null) => void;
    let publish!: (payload: UpdateStatusChangedPayload) => void;
    const installedVersions: string[] = [];
    const statuses: UpdateStatusChangedPayload[] = [];
    const connection = new UpdateStatusConnection({
      subscribeStatus: (listener) => {
        publish = listener;
        return { dispose: () => undefined };
      },
      takeInstalledVersion: () =>
        new Promise<string | null>((next) => {
          resolve = next;
        }),
      onStatus: (status) => statuses.push(status),
      onInstalledVersion: (version) => installedVersions.push(version),
    });

    connection.start();
    connection.stop();
    publish(STATUS);
    resolve("9.9.9");
    await _flushMicrotasks();

    expect(statuses).toEqual([]);
    expect(installedVersions).toEqual([]);
  });
});

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
