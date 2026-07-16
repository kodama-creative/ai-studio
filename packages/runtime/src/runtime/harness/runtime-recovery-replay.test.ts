import {
  claimRuntimeRunResume,
  InMemorySessionStore,
  recoverRuntimeSession,
  replayRuntimeRunEvents,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeRunReplayCursor,
  type RuntimeRunState,
  SessionStoreConflictError,
  SessionStoreInvariantError
} from "@llm-space/runtime/harness";
import { describe, expect, test } from "bun:test";

describe("Runtime Session recovery", () => {
  test("reconstructs idle and both safe-wait Sessions after hydration", async () => {
    const terminalSource = new InMemorySessionStore();
    const terminalStarted = await _start(
      terminalSource,
      "session-idle",
      "run-idle"
    );
    const terminal = await terminalSource.commit({
      sessionId: "session-idle",
      expectedVersion: terminalStarted.version,
      mutations: [_transition("run-idle", "completed")]
    });
    const idleStore = new InMemorySessionStore([terminal]);
    const idle = await recoverRuntimeSession(idleStore, "session-idle");
    expect(idle).toMatchObject({ status: "idle", session: terminal });
    const terminalResumeError = await _rejection(claimRuntimeRunResume(idleStore, {
      sessionId: "session-idle",
      runId: "run-idle",
      expectedVersion: terminal.version
    }));
    expect(terminalResumeError).toBeInstanceOf(SessionStoreInvariantError);
    expect(await idleStore.load("session-idle")).toEqual(terminal);

    for (const state of [
      "waitingForToolResults",
      "waitingForContinue"
    ] as const) {
      const source = new InMemorySessionStore();
      const started = await _start(source, `session-${state}`, `run-${state}`);
      const waiting = await source.commit({
        sessionId: `session-${state}`,
        expectedVersion: started.version,
        mutations: [
          _transition(`run-${state}`, "runningTools"),
          _transition(`run-${state}`, state)
        ]
      });
      const recoveredStore = new InMemorySessionStore([waiting]);
      const recovered = await recoverRuntimeSession(
        recoveredStore,
        `session-${state}`
      );

      expect(recovered).toMatchObject({
        status: "resumable",
        run: { id: `run-${state}`, state },
        session: { version: waiting.version }
      });
      if (recovered.status !== "resumable") {
        throw new Error("Expected a resumable Runtime Session");
      }
      const resumed = await claimRuntimeRunResume(recoveredStore, {
        sessionId: recovered.session.snapshot.id,
        runId: recovered.run.id,
        expectedVersion: recovered.session.version
      });
      expect(resumed.snapshot.activeRunId).toBe(recovered.run.id);
      expect(resumed.snapshot.runs.at(-1)?.state).toBe("runningModel");
    }
  });

  test("allows only one concurrent claimant to resume a safe wait", async () => {
    const store = new InMemorySessionStore();
    const started = await _start(store, "session-claim", "run-claim");
    const waiting = await store.commit({
      sessionId: "session-claim",
      expectedVersion: started.version,
      mutations: [
        _transition("run-claim", "runningTools"),
        _transition("run-claim", "waitingForContinue")
      ]
    });
    const claim = {
      sessionId: "session-claim",
      runId: "run-claim",
      expectedVersion: waiting.version
    };
    const contenders = await Promise.allSettled([
      claimRuntimeRunResume(store, claim),
      claimRuntimeRunResume(store, claim)
    ]);

    expect(contenders.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(contenders.find(item => item.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.any(SessionStoreConflictError)
    });
  });

  test("terminalizes interrupted model and tool work as outcome unknown", async () => {
    for (const state of ["runningModel", "runningTools"] as const) {
      const source = new InMemorySessionStore();
      const started = await _start(
        source,
        `session-unknown-${state}`,
        `run-unknown-${state}`
      );
      const interrupted = state === "runningTools"
        ? await source.commit({
          sessionId: `session-unknown-${state}`,
          expectedVersion: started.version,
          mutations: [_transition(`run-unknown-${state}`, "runningTools")]
        })
        : started;
      const recoveredStore = new InMemorySessionStore([interrupted]);
      const recovered = await recoverRuntimeSession(
        recoveredStore,
        `session-unknown-${state}`
      );

      expect(recovered).toMatchObject({
        status: "outcomeUnknown",
        run: { id: `run-unknown-${state}`, state: "outcomeUnknown" },
        session: { snapshot: { activeRunId: null } }
      });
      if (recovered.status !== "outcomeUnknown") {
        throw new Error("Expected an outcome-unknown Runtime Run");
      }
      const unknownResumeError = await _rejection(claimRuntimeRunResume(recoveredStore, {
        sessionId: recovered.session.snapshot.id,
        runId: recovered.run.id,
        expectedVersion: recovered.session.version
      }));
      expect(unknownResumeError).toBeInstanceOf(SessionStoreInvariantError);
      expect(recovered.session.journal.at(-1)).toMatchObject({
        type: "runStateChanged",
        from: state,
        to: "outcomeUnknown"
      });
      expect(replayRuntimeRunEvents(recovered.session, {
        sessionId: recovered.session.snapshot.id,
        runId: recovered.run.id
      }).at(-1)?.entry).toMatchObject({
        type: "runStateChanged",
        to: "outcomeUnknown"
      });
    }
  });

  test("reports a missing Session without manufacturing durable state", async () => {
    const store = new InMemorySessionStore();
    expect(await recoverRuntimeSession(store, "session-missing")).toEqual({
      status: "missing"
    });
    expect(await store.load("session-missing")).toBeNull();
  });
});

describe("Runtime Run replay", () => {
  test("rejects persisted journals that cannot reconstruct the Run snapshot", async () => {
    const store = new InMemorySessionStore();
    const started = await _start(store, "session-corrupt", "run-corrupt");
    const corrupted = structuredClone(started);
    const entry = corrupted.journal[0];
    if (entry?.type !== "runStarted") {
      throw new Error("Expected a run-start journal entry");
    }
    (entry as { configurationId: string; }).configurationId = "config-other";

    expect(() => new InMemorySessionStore([corrupted])).toThrow(
      SessionStoreInvariantError
    );
  });

  test("replays stable Run events after an exclusive validated cursor", async () => {
    const store = new InMemorySessionStore();
    const first = await _start(store, "session-replay", "run-first");
    const branched = await store.commit({
      sessionId: "session-replay",
      expectedVersion: first.version,
      mutations: [
        _transition("run-first", "superseded"),
        {
          type: "startRun",
          runId: "run-second",
          configuration: _configuration("config-second")
        }
      ]
    });
    const waiting = await store.commit({
      sessionId: "session-replay",
      expectedVersion: branched.version,
      mutations: [
        _transition("run-second", "runningTools"),
        _transition("run-second", "waitingForContinue")
      ]
    });
    const authorization = {
      sessionId: "session-replay",
      runId: "run-second"
    };
    const all = replayRuntimeRunEvents(waiting, authorization);

    expect(all.map(event => event.entry.sequence)).toEqual([3, 4, 5]);
    expect(all.map(event => event.entry.type)).toEqual([
      "runStarted",
      "runStateChanged",
      "runStateChanged"
    ]);
    expect(new Set(all.map(event => event.cursor.sequence)).size).toBe(3);
    expect(Object.isFrozen(all)).toBe(true);
    const afterSecond = replayRuntimeRunEvents(
      waiting,
      authorization,
      all[1]?.cursor
    );
    expect(afterSecond.map(event => event.entry.sequence)).toEqual([5]);
    expect(replayRuntimeRunEvents(
      waiting,
      authorization,
      all.at(-1)?.cursor
    )).toEqual([]);
  });

  test("rejects cross-scope, non-entry, and unsupported cursors", async () => {
    const store = new InMemorySessionStore();
    const first = await _start(store, "session-cursors", "run-one");
    const branched = await store.commit({
      sessionId: "session-cursors",
      expectedVersion: first.version,
      mutations: [
        _transition("run-one", "superseded"),
        {
          type: "startRun",
          runId: "run-two",
          configuration: _configuration("config-two")
        }
      ]
    });
    const authorization = { sessionId: "session-cursors", runId: "run-two" };
    const cursor = replayRuntimeRunEvents(branched, authorization)[0]?.cursor;
    if (!cursor) {
      throw new Error("Expected a replay cursor");
    }
    const invalid: RuntimeRunReplayCursor[] = [
      { ...cursor, sessionId: "session-other" },
      { ...cursor, runId: "run-one" },
      { ...cursor, sequence: 2 },
      { ...cursor, sequence: 999 },
      { ...cursor, schemaVersion: 2 as 1 }
    ];

    for (const item of invalid) {
      expect(() => replayRuntimeRunEvents(
        branched,
        authorization,
        item
      )).toThrow(SessionStoreInvariantError);
    }
    expect(() => replayRuntimeRunEvents(branched, {
      sessionId: "session-other",
      runId: "run-two"
    })).toThrow(SessionStoreInvariantError);
  });
});

async function _start(
  store: InMemorySessionStore,
  sessionId: string,
  runId: string
) {
  return store.commit({
    sessionId,
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId,
      configuration: _configuration()
    }]
  });
}

function _configuration(
  id = "config-one"
): RuntimeRunConfigurationSnapshot {
  return {
    id,
    agentSnapshotFingerprint: "agent-one",
    contextFingerprint: "context-one",
    executionMode: "manual",
    model: { provider: "fake", id: "model" },
    toolConfigurationFingerprint: "tools-one"
  };
}

function _transition(
  runId: string,
  to: RuntimeRunState
) {
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
