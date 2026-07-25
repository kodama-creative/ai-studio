import {
  RUNTIME_RUN_STATES,
  type RuntimeRunSnapshot,
  type RuntimeRunState,
  RuntimeRunTransitionError,
  transitionRuntimeRun
} from "@llm-space/runtime/harness";
import { describe, expect, test } from "bun:test";

const LEGAL_TRANSITIONS: Readonly<
  Record<RuntimeRunState, readonly RuntimeRunState[]>
> = {
  runningModel: [
    "runningTools",
    "waitingForBudget",
    "completed",
    "failed",
    "cancelled",
    "superseded",
    "outcomeUnknown"
  ],
  runningTools: [
    "runningModel",
    "waitingForApproval",
    "waitingForBudget",
    "waitingForToolResults",
    "waitingForContinue",
    "completed",
    "failed",
    "cancelled",
    "superseded",
    "outcomeUnknown"
  ],
  waitingForApproval: ["runningTools", "cancelled", "superseded"],
  waitingForBudget: ["runningModel", "cancelled", "superseded"],
  waitingForToolResults: [
    "waitingForContinue",
    "cancelled",
    "superseded"
  ],
  waitingForContinue: ["runningModel", "cancelled", "superseded"],
  completed: [],
  failed: [],
  cancelled: [],
  superseded: [],
  outcomeUnknown: []
};

describe("Runtime Run state machine", () => {
  test("accepts exactly the declared transition matrix", () => {
    for (const from of RUNTIME_RUN_STATES) {
      for (const to of RUNTIME_RUN_STATES) {
        const run = _run(from);
        if (LEGAL_TRANSITIONS[from].includes(to)) {
          expect(transitionRuntimeRun(run, to)).toEqual({ ...run, state: to });
        } else {
          expect(() => transitionRuntimeRun(run, to)).toThrow(
            RuntimeRunTransitionError
          );
        }
      }
    }
  });
});

function _run(state: RuntimeRunState): RuntimeRunSnapshot {
  return {
    baseCheckpointId: null,
    branchId: "branch-1",
    id: "run-one",
    inputHeadEntryId: null,
    sessionId: "session-one",
    configurationId: "config-one",
    state
  };
}
