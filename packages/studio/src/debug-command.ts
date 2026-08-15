import type { PiSessionSnapshot } from "@llm-space/pi-runtime";

import type { StudioStore } from "./storage";

interface ExecuteDebugCommandInput {
  readonly store: StudioStore;
  readonly sessionId: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly method: "step" | "continue";
  readonly input: unknown;
  readonly clock: () => number;
  readonly execute: () => Promise<PiSessionSnapshot>;
}

interface ReadDebugCommandReceiptInput {
  readonly store: StudioStore;
  readonly sessionId: string;
  readonly commandId: string;
  readonly method: "step" | "continue";
  readonly input: unknown;
}

/** Returns the original operation for a previously committed debugger command. */
export function readDebugCommandReceipt(
  options: ReadDebugCommandReceiptInput
): string | undefined {
  const existing = options.store.transaction((tx) =>
    tx.getCommandReceipt(options.sessionId, options.commandId)
  );
  if (existing === undefined) return undefined;
  const operationId = existing.operationId;
  if (
    operationId === undefined ||
    existing.method !== options.method ||
    existing.fingerprint !==
      _fingerprint(options.method, operationId, options.input)
  ) {
    throw new Error(
      `Command "${options.commandId}" was already used with other input.`
    );
  }
  return operationId;
}

/** Durably deduplicates one product debugger command across host restarts. */
export async function executeDebugCommand(
  options: ExecuteDebugCommandInput
): Promise<PiSessionSnapshot | undefined> {
  const fingerprint = _fingerprint(
    options.method,
    options.operationId,
    options.input
  );
  const existing = options.store.transaction((tx) =>
    tx.getCommandReceipt(options.sessionId, options.commandId)
  );
  if (existing !== undefined) {
    if (
      existing.method !== options.method ||
      existing.fingerprint !== fingerprint
    ) {
      throw new Error(
        `Command "${options.commandId}" was already used with other input.`
      );
    }
    return undefined;
  }

  const snapshot = await options.execute();
  options.store.transaction((tx) =>
    tx.insertCommandReceipt({
      sessionId: options.sessionId,
      commandId: options.commandId,
      method: options.method,
      fingerprint,
      operationId: options.operationId,
      ...(snapshot.leafId === null ? {} : { leafId: snapshot.leafId }),
      createdAt: options.clock(),
    })
  );
  return snapshot;
}

function _fingerprint(
  method: "step" | "continue",
  operationId: string,
  input: unknown
): string {
  return JSON.stringify({ method, operationId, input });
}
