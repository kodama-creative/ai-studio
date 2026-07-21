import { describe, expect, test } from "bun:test";

import type { RunSnapshot } from "@llm-space/core/thread";

import {
  groupRuntimeRunCheckpoints,
  runRuntimeProfileLabel
} from "./run-history-utils";

describe("groupRuntimeRunCheckpoints", () => {
  test("groups newest-first checkpoints by stable Runtime Run and keeps legacy rows", () => {
    const runs = [
      _run("checkpoint-three", "run-two", 1, "completed"),
      _run("checkpoint-two", "run-one", 2, "waitingForContinue"),
      _run("checkpoint-one", "run-one", 1, "waitingForToolResults"),
      _run("legacy", null, 1, "completed")
    ];

    const groups = groupRuntimeRunCheckpoints(
      runs,
      new Map([["run-one", "superseded"]])
    );

    expect(groups.map(group => ({
      id: group.runtimeRunId,
      state: group.state,
      checkpoints: group.runs.map(run => run.id)
    }))).toEqual([
      { id: "run-two", state: "completed", checkpoints: ["checkpoint-three"] },
      {
        id: "run-one",
        state: "superseded",
        checkpoints: ["checkpoint-two", "checkpoint-one"]
      },
      { id: null, state: null, checkpoints: ["legacy"] }
    ]);
  });
});

describe("runRuntimeProfileLabel", () => {
  test("labels every persisted Runtime Profile", () => {
    expect(runRuntimeProfileLabel({
      runId: "run-direct",
      state: "completed",
      checkpointOrder: 1,
      continuationFingerprint: "direct",
      profile: "desktopDirect"
    })).toBe("Desktop Direct");
    expect(runRuntimeProfileLabel({
      runId: "run-sandbox",
      state: "completed",
      checkpointOrder: 1,
      continuationFingerprint: "sandbox",
      profile: "desktopSandbox"
    })).toBe("Desktop Sandbox");
    expect(runRuntimeProfileLabel({
      runId: "run-server",
      state: "completed",
      checkpointOrder: 1,
      continuationFingerprint: "server",
      profile: "localServer"
    })).toBe("Local Server");
  });
});

function _run(
  id: string,
  runtimeRunId: string | null,
  checkpointOrder: number,
  state: NonNullable<RunSnapshot["runtime"]>["state"]
): RunSnapshot {
  return {
    id,
    thread: {},
    timestamp: checkpointOrder,
    ...(runtimeRunId
      ? {
        runtime: {
          runId: runtimeRunId,
          state,
          checkpointOrder,
          continuationFingerprint: `${runtimeRunId}-${checkpointOrder}`
        }
      }
      : {})
  };
}
