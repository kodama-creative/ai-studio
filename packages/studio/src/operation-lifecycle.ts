import type {
  DurablePiRuntime,
  PiSessionSnapshot,
} from "@llm-space/pi-runtime";

import {
  executeDebugCommand,
  readDebugCommandReceipt,
} from "./debug-command";
import type { StudioStore } from "./storage";

interface DriveAdmittedOperationInput {
  readonly store: StudioStore;
  readonly runtime: DurablePiRuntime;
  readonly productId: string;
  readonly sessionId: string;
  readonly lane: string;
  readonly initial: PiSessionSnapshot;
  readonly commandId: string;
  readonly commandInput: unknown;
  readonly mode?: "step" | "continue";
  readonly signal?: AbortSignal;
  readonly clock: () => number;
}

export interface DrivenOperation {
  readonly operationId: string;
  readonly snapshot: PiSessionSnapshot;
}

interface ResolveOperationAdmissionInput {
  readonly store: StudioStore;
  readonly runtime: DurablePiRuntime;
  readonly productId: string;
  readonly productLabel: string;
  readonly sessionId: string;
  readonly lane: string;
  readonly commandId: string;
  readonly commandInput: unknown;
  readonly mode?: "step" | "continue";
}

export type OperationAdmission =
  | { readonly kind: "receipt"; readonly operationId: string }
  | {
      readonly kind: "recover" | "admit";
      readonly operationId: string;
      readonly snapshot: PiSessionSnapshot;
    };

/** Resolves command replay, active-operation conflicts, and admission identity. */
export async function resolveOperationAdmission(
  input: ResolveOperationAdmissionInput
): Promise<OperationAdmission> {
  const operationId = operationIdForCommand(input.productId, input.commandId);
  if (input.mode !== undefined) {
    const receiptOperationId = readDebugCommandReceipt({
      store: input.store,
      sessionId: input.sessionId,
      commandId: input.commandId,
      method: input.mode,
      input: input.commandInput,
    });
    if (receiptOperationId !== undefined) {
      return { kind: "receipt", operationId: receiptOperationId };
    }
  }
  const snapshot = await input.runtime.open({
    sessionId: input.sessionId,
    lane: input.lane,
  });
  if (!hasActiveOperation(snapshot) || snapshot.operationId === undefined) {
    return { kind: "admit", operationId, snapshot };
  }
  if (snapshot.operationId !== operationId) {
    throw new Error(`${input.productLabel} has an active operation.`);
  }
  return { kind: "recover", operationId, snapshot };
}

/** Aborts the Pi-authoritative active operation, including during recovery. */
export async function cancelActiveOperation(input: {
  readonly runtime: DurablePiRuntime;
  readonly sessionId: string;
  readonly lane: string;
}): Promise<
  | { readonly operationId: string; readonly snapshot: PiSessionSnapshot }
  | undefined
> {
  const current = await input.runtime.open({
    sessionId: input.sessionId,
    lane: input.lane,
  });
  if (!hasActiveOperation(current) || current.operationId === undefined) {
    return undefined;
  }
  const snapshot = await input.runtime.abort({
    sessionId: input.sessionId,
    lane: input.lane,
  });
  return { operationId: current.operationId, snapshot };
}

/** Applies an initial Step/Continue command to an already-admitted Pi operation. */
export async function driveAdmittedOperation(
  input: DriveAdmittedOperationInput
): Promise<DrivenOperation> {
  let snapshot = input.initial;
  const operationId =
    snapshot.operationId ?? operationIdForCommand(input.productId, input.commandId);
  if (input.signal?.aborted) {
    if (hasActiveOperation(snapshot)) {
      snapshot = await input.runtime.abort({
        sessionId: input.sessionId,
        lane: input.lane,
      });
    }
    return { operationId, snapshot };
  }
  if (input.mode === "continue") {
    snapshot = await executeDebugCommand({
      store: input.store,
      sessionId: input.sessionId,
      operationId,
      commandId: input.commandId,
      method: "continue",
      input: input.commandInput,
      clock: input.clock,
      readCurrent: () =>
        input.runtime.open({ sessionId: input.sessionId, lane: input.lane }),
      needsExecution: (current) => current.status === "paused",
      execute: () =>
        input.runtime.continue({
          sessionId: input.sessionId,
          lane: input.lane,
        }),
    });
  } else if (input.mode === "step" && snapshot.nextAction !== undefined) {
    const action = snapshot.nextAction;
    snapshot = await executeDebugCommand({
      store: input.store,
      sessionId: input.sessionId,
      operationId,
      commandId: input.commandId,
      method: "step",
      input: input.commandInput,
      clock: input.clock,
      readCurrent: () =>
        input.runtime.open({ sessionId: input.sessionId, lane: input.lane }),
      needsExecution: (current) => current.nextAction?.id === action.id,
      execute: () =>
        input.runtime.step({
          sessionId: input.sessionId,
          lane: input.lane,
          expectedActionId: action.id,
          kind: action.kind,
        }),
    });
  }
  return { operationId, snapshot };
}

/** Maps a product command to one stable Pi operation identity. */
export function operationIdForCommand(
  productId: string,
  commandId: string
): string {
  return `operation:${productId}:${commandId}`;
}

/** Pi exposes active identity only while an action or suspension remains. */
export function hasActiveOperation(snapshot: PiSessionSnapshot): boolean {
  return snapshot.nextAction !== undefined || snapshot.status === "suspended";
}
