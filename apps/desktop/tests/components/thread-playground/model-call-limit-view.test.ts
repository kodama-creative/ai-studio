import { describe, expect, test } from "bun:test";

import type { StoredRuntimeSession } from "@llm-space/runtime/harness";

import {
  modelCallLimitView
} from "../../../src/components/thread-playground/model-call-limit-view";

describe("model-call limit presentation", () => {
  test("shows the source default before a Run and hides explicit false", () => {
    expect(modelCallLimitView(undefined, {
      maxModelCallsPerRun: 25
    })).toEqual({ limit: 25, reached: false, used: 0 });
    expect(modelCallLimitView(undefined, {
      maxModelCallsPerRun: false
    })).toBeNull();
  });

  test("counts only dispatched main-provider identities and retains failure", () => {
    const session = _session();

    expect(modelCallLimitView(session, {
      maxModelCallsPerRun: 2
    })).toEqual({
      failure: {
        axis: "modelCalls",
        attempted: 3,
        code: "runLimitExceeded",
        consumed: 2,
        limit: 2
      },
      limit: 2,
      reached: true,
      used: 2
    });
    expect(modelCallLimitView(session, {
      maxModelCallsPerRun: 9
    })).toEqual({
      failure: expect.objectContaining({ code: "runLimitExceeded" }),
      limit: 2,
      reached: true,
      used: 2
    });

    const atLimit = structuredClone(session);
    Reflect.deleteProperty(atLimit.snapshot.runs[0]!, "failure");
    expect(modelCallLimitView(atLimit, {
      maxModelCallsPerRun: 2
    })).toEqual({
      limit: 2,
      reached: true,
      used: 2
    });
  });
});

function _session(): StoredRuntimeSession {
  const failure = {
    axis: "modelCalls" as const,
    attempted: 3,
    code: "runLimitExceeded" as const,
    consumed: 2,
    limit: 2
  };
  return {
    version: 1,
    configurations: [{
      id: "configuration-one",
      agentSnapshotFingerprint: "agent",
      contextFingerprint: "context",
      executionMode: "react",
      limits: { maxModelCallsPerRun: 2 },
      model: { provider: "fake", id: "model" },
      toolConfigurationFingerprint: "tools"
    }],
    journal: [],
    snapshot: {
      schemaVersion: 6,
      activeRunId: "run-one",
      history: {
        schemaVersion: 1,
        branches: [],
        checkpoints: [],
        compactions: [],
        currentBranchId: null,
        currentCheckpointId: null,
        entries: []
      },
      id: "session-one",
      runs: [{
        baseCheckpointId: null,
        branchId: "branch-one",
        configurationId: "configuration-one",
        failure,
        id: "run-one",
        inputHeadEntryId: null,
        sessionId: "session-one",
        state: "failed"
      }],
      operationLedger: {
        schemaVersion: 1,
        steps: [{
          id: "step-one",
          operations: [
            _operation("main-one", "completed"),
            _operation("main-two", "failed"),
            _operation("cancelled", "cancelled"),
            { ..._operation("summary", "completed"), providerSlot: "compaction" }
          ],
          runId: "run-one",
          sequence: 1,
          state: "checkpointed",
          transcriptMessageCount: 0
        }]
      }
    }
  };
}

function _operation(
  id: string,
  state: "cancelled" | "completed" | "failed"
) {
  return {
    attempt: 1,
    id,
    idempotency: { mode: "none" as const },
    kind: "provider" as const,
    provider: "fake",
    requestFingerprint: "a".repeat(64),
    runId: "run-one",
    settledAt: 1,
    startedAt: 0,
    state,
    stepId: "step-one"
  };
}
