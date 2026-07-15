import { describe, expect, test } from "bun:test";

import {
  type BeforeQuitEvent,
  createShutdownCoordinator
} from "./shutdown-coordinator";

describe("createShutdownCoordinator", () => {
  test("cancels quit until asynchronous cleanup completes", async () => {
    let finishStop: (() => void) | undefined;
    let finishQuit: (() => void) | undefined;
    const stop = new Promise<void>(resolve => {
      finishStop = resolve;
    });
    const quit = new Promise<void>(resolve => {
      finishQuit = resolve;
    });
    const events: string[] = [];
    const handleBeforeQuit = createShutdownCoordinator({
      quit: () => {
        events.push("quit");
        finishQuit?.();
      },
      stop: async () => {
        events.push("stop");
        await stop;
      }
    });
    const firstQuit: BeforeQuitEvent = {};

    handleBeforeQuit(firstQuit);
    expect(firstQuit.response).toEqual({ allow: false });
    expect(events).toEqual(["stop"]);

    finishStop?.();
    await quit;
    expect(events).toEqual(["stop", "quit"]);

    const secondQuit: BeforeQuitEvent = {};
    handleBeforeQuit(secondQuit);
    expect(secondQuit.response).toBeUndefined();
  });

  test("prevents repeated quits during cleanup and exits after an error", async () => {
    let finishQuit: (() => void) | undefined;
    const quit = new Promise<void>(resolve => {
      finishQuit = resolve;
    });
    const errors: string[] = [];
    const events: string[] = [];
    const handleBeforeQuit = createShutdownCoordinator({
      quit: () => {
        events.push("quit");
        finishQuit?.();
      },
      stop: async () => {
        events.push("stop");
        throw new Error("cleanup failed");
      },
      onStopError: error => {
        errors.push(error.message);
      }
    });
    const firstQuit: BeforeQuitEvent = {};
    const repeatedQuit: BeforeQuitEvent = {};

    handleBeforeQuit(firstQuit);
    handleBeforeQuit(repeatedQuit);
    expect(firstQuit.response).toEqual({ allow: false });
    expect(repeatedQuit.response).toEqual({ allow: false });

    await quit;
    expect(events).toEqual(["stop", "quit"]);
    expect(errors).toEqual(["cleanup failed"]);
  });
});
