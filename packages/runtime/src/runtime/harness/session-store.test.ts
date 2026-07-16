import {
  InMemorySessionStore,
  RUNTIME_RUN_STATES,
  RUNTIME_SESSION_SCHEMA_VERSION,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeRunSnapshot,
  type RuntimeRunState,
  RuntimeRunTransitionError,
  type SessionStore,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  transitionRuntimeRun
} from "@llm-space/runtime/harness";
import { describe, expect, test } from "bun:test";

const LEGAL_TRANSITIONS: Readonly<
  Record<RuntimeRunState, readonly RuntimeRunState[]>
> = {
  runningModel: [
    "runningTools",
    "completed",
    "failed",
    "cancelled",
    "superseded",
    "outcomeUnknown"
  ],
  runningTools: [
    "runningModel",
    "waitingForToolResults",
    "waitingForContinue",
    "completed",
    "failed",
    "cancelled",
    "superseded",
    "outcomeUnknown"
  ],
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

describe("InMemorySessionStore", () => {
  test("hydrates a persisted safe-boundary Session without replaying mutations", async () => {
    const original = new InMemorySessionStore();
    const started = await original.commit({
      sessionId: "session-hydrated",
      expectedVersion: null,
      mutations: [
        {
          type: "startRun",
          runId: "run-hydrated",
          configuration: _configuration("config-hydrated")
        },
        {
          type: "transitionRun",
          runId: "run-hydrated",
          to: "runningTools"
        },
        {
          type: "transitionRun",
          runId: "run-hydrated",
          to: "waitingForContinue"
        }
      ]
    });

    const hydrated = new InMemorySessionStore([started]);
    expect(await hydrated.load("session-hydrated")).toEqual(started);
    const resumed = await hydrated.commit({
      sessionId: "session-hydrated",
      expectedVersion: started.version,
      mutations: [
        {
          type: "transitionRun",
          runId: "run-hydrated",
          to: "runningModel"
        }
      ]
    });

    expect(resumed.snapshot.activeRunId).toBe("run-hydrated");
    expect(resumed.snapshot.runs.at(-1)?.state).toBe("runningModel");
    expect(resumed.journal).toHaveLength(started.journal.length + 1);
  });

  test("keeps checkpoint order and continuation identity in the Session Store", async () => {
    const store = new InMemorySessionStore();
    const waiting = await store.commit({
      sessionId: "session-checkpoints",
      expectedVersion: null,
      mutations: [
        {
          type: "startRun",
          runId: "run-checkpoints",
          configuration: _configuration("config-checkpoints")
        },
        { type: "transitionRun", runId: "run-checkpoints", to: "runningTools" },
        {
          type: "transitionRun",
          runId: "run-checkpoints",
          to: "waitingForToolResults"
        },
        {
          type: "recordCheckpoint",
          runId: "run-checkpoints",
          continuationFingerprint: "continuation-one"
        }
      ]
    });
    const resumed = await store.commit({
      sessionId: "session-checkpoints",
      expectedVersion: waiting.version,
      mutations: [
        {
          type: "transitionRun",
          runId: "run-checkpoints",
          to: "waitingForContinue"
        },
        {
          type: "transitionRun",
          runId: "run-checkpoints",
          to: "runningModel"
        },
        { type: "transitionRun", runId: "run-checkpoints", to: "completed" },
        {
          type: "recordCheckpoint",
          runId: "run-checkpoints",
          continuationFingerprint: "continuation-two"
        }
      ]
    });

    expect(waiting.snapshot.runs[0]?.checkpoint).toEqual({
      order: 1,
      state: "waitingForToolResults",
      continuationFingerprint: "continuation-one"
    });
    expect(resumed.snapshot.runs[0]?.checkpoint).toEqual({
      order: 2,
      state: "completed",
      continuationFingerprint: "continuation-two"
    });
    expect(resumed.journal.filter(entry =>
      entry.type === "runCheckpointRecorded")).toHaveLength(2);
  });

  test("rejects malformed persisted Sessions instead of silently dropping them", () => {
    expect(() =>
      new InMemorySessionStore([
        {
          version: 1,
          snapshot: {
            schemaVersion: RUNTIME_SESSION_SCHEMA_VERSION,
            id: "session-invalid",
            activeRunId: "missing-run",
            runs: []
          },
          configurations: [],
          journal: []
        }
      ])).toThrow(SessionStoreInvariantError);
  });

  test("keeps one Run identity through model, tool, wait, and completion states", async () => {
    const store: SessionStore = new InMemorySessionStore();
    const created = await store.commit({
      sessionId: "session-one",
      expectedVersion: null,
      mutations: [_start("run-one", _configuration())]
    });
    const waitingForResults = await store.commit({
      sessionId: "session-one",
      expectedVersion: created.version,
      mutations: [
        _transition("run-one", "runningTools"),
        _transition("run-one", "waitingForToolResults")
      ]
    });
    const waitingForContinue = await store.commit({
      sessionId: "session-one",
      expectedVersion: waitingForResults.version,
      mutations: [_transition("run-one", "waitingForContinue")]
    });
    const completed = await store.commit({
      sessionId: "session-one",
      expectedVersion: waitingForContinue.version,
      mutations: [
        _transition("run-one", "runningModel"),
        _transition("run-one", "completed")
      ]
    });

    expect(completed).toMatchObject({
      version: 4,
      snapshot: {
        schemaVersion: 1,
        id: "session-one",
        activeRunId: null,
        runs: [
          {
            id: "run-one",
            sessionId: "session-one",
            configurationId: "config-one",
            state: "completed"
          }
        ]
      }
    });
    expect(completed.journal.map(entry => entry.sequence)).toEqual([
      1, 2, 3, 4, 5, 6
    ]);
    expect(completed.journal.map(entry => entry.sessionVersion)).toEqual([
      1, 2, 2, 3, 4, 4
    ]);
    expect(completed.journal.map(entry => entry.type)).toEqual([
      "runStarted",
      "runStateChanged",
      "runStateChanged",
      "runStateChanged",
      "runStateChanged",
      "runStateChanged"
    ]);
  });

  test("atomically supersedes an active Run before starting its branch", async () => {
    const store = new InMemorySessionStore();
    const created = await store.commit({
      sessionId: "session-branch",
      expectedVersion: null,
      mutations: [_start("run-original", _configuration())]
    });

    expect(
      await _rejection(store.commit({
        sessionId: "session-branch",
        expectedVersion: created.version,
        mutations: [_start("run-branch", _configuration("config-branch"))]
      }))
    ).toBeInstanceOf(SessionStoreInvariantError);

    const branched = await store.commit({
      sessionId: "session-branch",
      expectedVersion: created.version,
      mutations: [
        _transition("run-original", "superseded"),
        _start("run-branch", _configuration("config-branch"))
      ]
    });

    expect(branched.snapshot.activeRunId).toBe("run-branch");
    expect(branched.snapshot.runs.map(run => [run.id, run.state])).toEqual([
      ["run-original", "superseded"],
      ["run-branch", "runningModel"]
    ]);
    expect(branched.configurations.map(item => item.id)).toEqual([
      "config-one",
      "config-branch"
    ]);
    expect(branched.journal.map(entry => entry.sequence)).toEqual([1, 2, 3]);
  });

  test("rejects stale and simultaneous writers through compare-and-swap", async () => {
    const store = new InMemorySessionStore();
    const created = await store.commit({
      sessionId: "session-cas",
      expectedVersion: null,
      mutations: [_start("run-cas", _configuration())]
    });
    const contenders = await Promise.allSettled([
      store.commit({
        sessionId: "session-cas",
        expectedVersion: created.version,
        mutations: [_transition("run-cas", "failed")]
      }),
      store.commit({
        sessionId: "session-cas",
        expectedVersion: created.version,
        mutations: [_transition("run-cas", "cancelled")]
      })
    ]);

    expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = contenders.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(SessionStoreConflictError)
    });
    expect(
      await _rejection(store.commit({
        sessionId: "session-cas",
        expectedVersion: created.version,
        mutations: [_transition("run-cas", "cancelled")]
      }))
    ).toMatchObject({
      name: "SessionStoreConflictError",
      expectedVersion: 1,
      actualVersion: 2
    });
  });

  test("rolls back the whole commit when configuration identity changes", async () => {
    const store = new InMemorySessionStore();
    const created = await store.commit({
      sessionId: "session-atomic",
      expectedVersion: null,
      mutations: [_start("run-original", _configuration())]
    });
    const changedConfiguration = {
      ..._configuration(),
      contextFingerprint: "changed-context"
    };

    expect(
      await _rejection(store.commit({
        sessionId: "session-atomic",
        expectedVersion: created.version,
        mutations: [
          _transition("run-original", "superseded"),
          _start("run-replacement", changedConfiguration)
        ]
      }))
    ).toMatchObject({
      message: "Run Configuration Snapshot config-one is immutable"
    });

    const stored = await store.load("session-atomic");
    expect(stored).toEqual(created);
    expect(stored?.snapshot.runs[0]?.state).toBe("runningModel");
    expect(stored?.journal).toHaveLength(1);
  });

  test("snapshots inputs and returns deeply immutable records", async () => {
    const store = new InMemorySessionStore();
    const configuration = _configuration();
    const created = await store.commit({
      sessionId: "session-immutable",
      expectedVersion: null,
      mutations: [_start("run-immutable", configuration)]
    });
    (configuration.model as { provider: string; }).provider = "changed";

    const loaded = await store.load("session-immutable");
    expect(loaded?.configurations[0]?.model.provider).toBe("fake");
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.snapshot.runs)).toBe(true);
    expect(Object.isFrozen(created.configurations[0]?.model)).toBe(true);
    expect(() => {
      (created.snapshot as { activeRunId: string | null; }).activeRunId = null;
    }).toThrow();
  });

  test("rejects illegal and terminal transitions without changing the Session", async () => {
    const store = new InMemorySessionStore();
    const created = await store.commit({
      sessionId: "session-illegal",
      expectedVersion: null,
      mutations: [_start("run-illegal", _configuration())]
    });

    expect(
      await _rejection(store.commit({
        sessionId: "session-illegal",
        expectedVersion: created.version,
        mutations: [_transition("run-illegal", "waitingForContinue")]
      }))
    ).toBeInstanceOf(RuntimeRunTransitionError);
    expect(await store.load("session-illegal")).toEqual(created);

    const completed = await store.commit({
      sessionId: "session-illegal",
      expectedVersion: created.version,
      mutations: [_transition("run-illegal", "completed")]
    });
    expect(
      await _rejection(store.commit({
        sessionId: "session-illegal",
        expectedVersion: completed.version,
        mutations: [_transition("run-illegal", "runningModel")]
      }))
    ).toBeInstanceOf(SessionStoreInvariantError);
    expect(await store.load("session-illegal")).toEqual(completed);
  });
});

function _run(state: RuntimeRunState): RuntimeRunSnapshot {
  return {
    id: "run-one",
    sessionId: "session-one",
    configurationId: "config-one",
    state
  };
}

function _configuration(
  id = "config-one"
): RuntimeRunConfigurationSnapshot {
  return {
    id,
    agentSnapshotFingerprint: "agent-one",
    contextFingerprint: "context-one",
    executionMode: "manual",
    model: { provider: "fake", id: "fake-model" },
    reasoning: "high",
    toolConfigurationFingerprint: "tools-one"
  };
}

function _start(
  runId: string,
  configuration: RuntimeRunConfigurationSnapshot
) {
  return { type: "startRun" as const, runId, configuration };
}

function _transition(runId: string, to: RuntimeRunState) {
  return { type: "transitionRun" as const, runId, to };
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}
