import { expect, test } from "bun:test";

import type { PiSessionSnapshot } from "@llm-space/pi-runtime";

import { executeDebugCommand } from "./debug-command";
import { InMemoryStudioStore, type StudioStore } from "./storage";

const CURRENT: PiSessionSnapshot = {
  cursor: 2,
  sessionId: "session-1",
  lane: "main",
  operationId: "operation-1",
  status: "completed",
  messageEntries: [],
  messages: [],
  leafId: "leaf-1",
};

test("reconciles an applied debugger command when receipt finalization failed", async () => {
  const inner = new InMemoryStudioStore();
  let failFinalization = true;
  const store: StudioStore = {
    transaction(fn) {
      return inner.transaction((tx) => {
        const faulting = Object.create(tx) as typeof tx;
        faulting.saveCommandReceipt = (receipt) => {
          if (failFinalization) {
            failFinalization = false;
            throw new Error("simulated receipt finalization crash");
          }
          tx.saveCommandReceipt(receipt);
        };
        return fn(faulting);
      });
    },
    close: () => inner.close(),
  };
  let effects = 0;
  const command = () =>
    executeDebugCommand({
      store,
      sessionId: "session-1",
      operationId: "operation-1",
      commandId: "step-1",
      method: "step",
      input: { expectedActionId: "action-1", kind: "model" },
      clock: () => 1,
      readCurrent: () => Promise.resolve(CURRENT),
      needsExecution: (snapshot) => snapshot.nextAction?.id === "action-1",
      execute: () => {
        effects += 1;
        return Promise.resolve(CURRENT);
      },
    });

  expect(command()).rejects.toThrow("simulated receipt finalization crash");
  expect(await command()).toEqual(CURRENT);
  expect(effects).toBe(1);
  expect(
    inner.transaction((tx) => tx.getCommandReceipt("session-1", "step-1"))
  ).toMatchObject({ status: "applied", operationId: "operation-1" });
});
