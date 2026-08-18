import type { DocumentDriveMode } from "@llm-space/engine";
import { DocumentExecutionEngine } from "@llm-space/engine";
import type { PiSessionSnapshot } from "@llm-space/pi-runtime";

interface DriveAdmittedOperationInput {
  readonly engine: DocumentExecutionEngine;
  readonly sessionId: string;
  readonly lane: string;
  readonly initial: PiSessionSnapshot;
  readonly mode: DocumentDriveMode;
  readonly signal?: AbortSignal;
}

export interface DrivenOperation {
  readonly operationId: string;
  readonly snapshot: PiSessionSnapshot;
}

/** Rejects a second admission and allocates a host-owned operation identity. */
export async function resolveOperationAdmission(input: {
  readonly engine: DocumentExecutionEngine;
  readonly sessionId: string;
  readonly lane: string;
  readonly generateOperationId: () => string;
}): Promise<
  | {
      readonly kind: "admit";
      readonly operationId: string;
      readonly snapshot: PiSessionSnapshot;
    }
  | {
      readonly kind: "recover";
      readonly operationId: string;
      readonly snapshot: PiSessionSnapshot;
    }
> {
  const snapshot = await input.engine.open({
    sessionId: input.sessionId,
    lane: input.lane,
  });
  if (hasActiveOperation(snapshot) && snapshot.operationId !== undefined) {
    return {
      kind: "recover",
      operationId: snapshot.operationId,
      snapshot,
    };
  }
  return {
    kind: "admit",
    operationId: input.generateOperationId(),
    snapshot,
  };
}

/** Aborts the Pi-authoritative active operation, including during recovery. */
export async function cancelActiveOperation(input: {
  readonly engine: DocumentExecutionEngine;
  readonly sessionId: string;
  readonly lane: string;
}): Promise<
  | { readonly operationId: string; readonly snapshot: PiSessionSnapshot }
  | undefined
> {
  const current = await input.engine.open({
    sessionId: input.sessionId,
    lane: input.lane,
  });
  if (!hasActiveOperation(current) || current.operationId === undefined) {
    return undefined;
  }
  const snapshot = await input.engine.cancel({
    sessionId: input.sessionId,
    lane: input.lane,
  });
  return { operationId: current.operationId, snapshot };
}

/** Applies the selected drive mode after product admission metadata commits. */
export async function driveAdmittedOperation(
  input: DriveAdmittedOperationInput
): Promise<DrivenOperation> {
  const operationId = input.initial.operationId;
  if (operationId === undefined) {
    throw new Error("An admitted Pi operation must expose its identity.");
  }
  if (input.signal?.aborted) {
    const snapshot = hasActiveOperation(input.initial)
      ? await input.engine.cancel({
          sessionId: input.sessionId,
          lane: input.lane,
        })
      : input.initial;
    return { operationId, snapshot };
  }
  const snapshot = await input.engine.drive({
    sessionId: input.sessionId,
    lane: input.lane,
    operationId,
    mode: input.mode,
    signal: input.signal,
  });
  return { operationId, snapshot };
}

/** Pi exposes active identity only while an action or suspension remains. */
export function hasActiveOperation(snapshot: PiSessionSnapshot): boolean {
  return snapshot.nextAction !== undefined || snapshot.status === "suspended";
}
