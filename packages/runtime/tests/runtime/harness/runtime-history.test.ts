import {
  InMemorySessionStore,
  runtimeHistoryMessagePath,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeSessionMutation,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  type StoredRuntimeSession,
  UnsupportedRuntimeSessionSchemaError
} from "@llm-space/runtime/harness";
import { describe, expect, test } from "bun:test";

import { sha256 } from "../../../src/runtime/harness/sha256";

describe("Runtime V4 history", () => {
  test("continues a branch head and forks only when a Run starts from history", async () => {
    const store = new InMemorySessionStore();
    const firstInput = [_user("first")];
    const first = await store.commit({
      sessionId: "session-tree",
      expectedVersion: null,
      mutations: [_start("run-one", firstInput)]
    });
    const firstSettled = await store.commit({
      sessionId: "session-tree",
      expectedVersion: first.version,
      mutations: [
        _transition("run-one", "completed"),
        _checkpoint("run-one", [...firstInput, _assistant("one")], "one")
      ]
    });
    const checkpointOne = firstSettled.snapshot.history.currentCheckpointId;
    expect(checkpointOne).toBe("run-one:checkpoint:1");

    const secondInput = [
      ...firstInput,
      _assistant("one"),
      _user("second")
    ];
    const second = await store.commit({
      sessionId: "session-tree",
      expectedVersion: firstSettled.version,
      mutations: [{
        ..._start("run-two", secondInput),
        workingBase: {
          branchId: "branch-1",
          checkpointId: checkpointOne!
        }
      }]
    });
    expect(second.snapshot.history.branches).toHaveLength(1);
    expect(second.snapshot.runs.at(-1)).toMatchObject({
      branchId: "branch-1",
      baseCheckpointId: checkpointOne
    });
    const secondSettled = await store.commit({
      sessionId: "session-tree",
      expectedVersion: second.version,
      mutations: [
        _transition("run-two", "completed"),
        _checkpoint("run-two", [...secondInput, _assistant("two")], "two")
      ]
    });

    const forkInput = [
      ...firstInput,
      _assistant("one"),
      _user("alternative")
    ];
    const forked = await store.commit({
      sessionId: "session-tree",
      expectedVersion: secondSettled.version,
      mutations: [{
        ..._start("run-fork", forkInput),
        workingBase: {
          branchId: "branch-1",
          checkpointId: checkpointOne!
        }
      }]
    });

    expect(forked.snapshot.history.branches).toEqual([
      expect.objectContaining({
        id: "branch-1",
        label: "Main",
        ordinal: 1,
        parentCheckpointId: null,
        headCheckpointId: "run-two:checkpoint:1"
      }),
      expect.objectContaining({
        id: "branch-2",
        label: "Branch 2",
        ordinal: 2,
        parentCheckpointId: checkpointOne,
        headCheckpointId: checkpointOne
      })
    ]);
    expect(forked.snapshot.runs.at(-1)).toMatchObject({
      id: "run-fork",
      branchId: "branch-2",
      baseCheckpointId: checkpointOne
    });
    expect(forked.snapshot.history.currentCheckpointId).toBe(checkpointOne);
  });

  test("reuses the immutable prefix when a restored working copy is edited", async () => {
    const store = new InMemorySessionStore();
    const original = [
      _user("shared request"),
      _assistant("shared answer"),
      _user("original tail")
    ];
    const started = await store.commit({
      sessionId: "session-prefix",
      expectedVersion: null,
      mutations: [_start("run-original", original)]
    });
    const settled = await store.commit({
      sessionId: "session-prefix",
      expectedVersion: started.version,
      mutations: [
        _transition("run-original", "completed"),
        _checkpoint(
          "run-original",
          [...original, _assistant("original result")],
          "original"
        )
      ]
    });
    const originalCount = settled.snapshot.history.entries.length;
    const base = settled.snapshot.history.currentCheckpointId!;
    const edited = [
      _user("shared request"),
      _assistant("shared answer"),
      _user("edited tail")
    ];
    const forked = await store.commit({
      sessionId: "session-prefix",
      expectedVersion: settled.version,
      mutations: [{
        ..._start("run-edited", edited),
        workingBase: { branchId: "branch-1", checkpointId: base }
      }]
    });
    const run = forked.snapshot.runs.at(-1)!;
    const path = runtimeHistoryMessagePath(
      forked.snapshot.history,
      run.inputHeadEntryId
    );

    expect(path.map(entry => entry.message)).toEqual(edited);
    expect(path.slice(0, 2).map(entry => entry.id)).toEqual(
      runtimeHistoryMessagePath(
        settled.snapshot.history,
        settled.snapshot.runs[0]!.inputHeadEntryId
      ).slice(0, 2).map(entry => entry.id)
    );
    expect(forked.snapshot.history.entries).toHaveLength(originalCount + 1);
  });

  test("admits exactly one concurrent fork from the same checkpoint", async () => {
    const { session, store } = await _settledSession("session-fork-cas");
    const checkpointId = session.snapshot.history.currentCheckpointId!;
    const continuedMessages = [
      _user("base"),
      _assistant("done"),
      _user("continued")
    ];
    const continued = await store.commit({
      sessionId: "session-fork-cas",
      expectedVersion: session.version,
      mutations: [{
        ..._start("run-continued", continuedMessages),
        workingBase: { branchId: "branch-1", checkpointId }
      }]
    });
    const continuedSettled = await store.commit({
      sessionId: "session-fork-cas",
      expectedVersion: continued.version,
      mutations: [
        _transition("run-continued", "completed"),
        _checkpoint(
          "run-continued",
          [...continuedMessages, _assistant("continued done")],
          "continued"
        )
      ]
    });
    const contenders = await Promise.allSettled([
      store.commit({
        sessionId: "session-fork-cas",
        expectedVersion: continuedSettled.version,
        mutations: [{
          ..._start("run-left", [
            _user("base"),
            _assistant("done"),
            _user("left")
          ]),
          workingBase: { branchId: "branch-1", checkpointId }
        }]
      }),
      store.commit({
        sessionId: "session-fork-cas",
        expectedVersion: continuedSettled.version,
        mutations: [{
          ..._start("run-right", [
            _user("base"),
            _assistant("done"),
            _user("right")
          ]),
          workingBase: { branchId: "branch-1", checkpointId }
        }]
      })
    ]);

    expect(contenders.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(contenders.filter(item => item.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.any(SessionStoreConflictError) })
    ]);
    const loaded = await store.load("session-fork-cas");
    expect(loaded?.snapshot.history.branches).toHaveLength(2);
    expect(loaded?.snapshot.history.branches.at(-1)).toMatchObject({
      id: "branch-2",
      parentCheckpointId: checkpointId
    });
    expect(loaded?.snapshot.runs).toHaveLength(3);
  });

  test("reconstructs a sixty-turn session with two explicit forks", async () => {
    let store = new InMemorySessionStore();
    let session: StoredRuntimeSession | null = null;
    const mainTranscript: Array<ReturnType<typeof _assistant | typeof _user>> = [];
    let forkBaseCheckpointId = "";
    let forkBaseTranscript: typeof mainTranscript = [];

    for (let turn = 1; turn <= 60; turn += 1) {
      const runId = `run-turn-${turn}`;
      const input = [...mainTranscript, _user(`turn ${turn}`)];
      const started = await store.commit({
        sessionId: "session-sixty-turns",
        expectedVersion: session?.version ?? null,
        mutations: [_start(runId, input)]
      });
      mainTranscript.push(_user(`turn ${turn}`), _assistant(`answer ${turn}`));
      session = await store.commit({
        sessionId: "session-sixty-turns",
        expectedVersion: started.version,
        mutations: [
          _transition(runId, "completed"),
          _checkpoint(runId, mainTranscript, `turn-${turn}`)
        ]
      });
      if (turn === 30) {
        forkBaseCheckpointId = session.snapshot.history.currentCheckpointId!;
        forkBaseTranscript = [...mainTranscript];
      }
    }

    expect(session?.snapshot.runs).toHaveLength(60);
    expect(session?.snapshot.history.checkpoints).toHaveLength(60);
    store = new InMemorySessionStore([session!]);

    const firstForkMessages = [...forkBaseTranscript, _user("first fork")];
    const firstFork = await store.commit({
      sessionId: "session-sixty-turns",
      expectedVersion: session!.version,
      mutations: [{
        ..._start("run-first-fork", firstForkMessages),
        workingBase: {
          branchId: "branch-1",
          checkpointId: forkBaseCheckpointId
        }
      }]
    });
    const firstForkSettled = await store.commit({
      sessionId: "session-sixty-turns",
      expectedVersion: firstFork.version,
      mutations: [
        _transition("run-first-fork", "completed"),
        _checkpoint(
          "run-first-fork",
          [...firstForkMessages, _assistant("first fork done")],
          "fork-one"
        )
      ]
    });

    const secondForkMessages = [...forkBaseTranscript, _user("second fork")];
    const secondFork = await store.commit({
      sessionId: "session-sixty-turns",
      expectedVersion: firstForkSettled.version,
      mutations: [{
        ..._start("run-second-fork", secondForkMessages),
        workingBase: {
          branchId: "branch-1",
          checkpointId: forkBaseCheckpointId
        }
      }]
    });
    const secondForkSettled = await store.commit({
      sessionId: "session-sixty-turns",
      expectedVersion: secondFork.version,
      mutations: [
        _transition("run-second-fork", "completed"),
        _checkpoint(
          "run-second-fork",
          [...secondForkMessages, _assistant("second fork done")],
          "fork-two"
        )
      ]
    });

    const restarted = new InMemorySessionStore([secondForkSettled]);
    const loaded = await restarted.load("session-sixty-turns");
    expect(loaded?.snapshot.history.branches).toEqual([
      expect.objectContaining({ id: "branch-1", parentCheckpointId: null }),
      expect.objectContaining({
        id: "branch-2",
        parentCheckpointId: forkBaseCheckpointId
      }),
      expect.objectContaining({
        id: "branch-3",
        parentCheckpointId: forkBaseCheckpointId
      })
    ]);
    expect(loaded?.snapshot.runs).toHaveLength(62);
    expect(loaded?.snapshot.history.checkpoints).toHaveLength(62);
    expect(loaded?.snapshot.history.entries.slice(0, mainTranscript.length)
      .map(entry => entry.message)).toEqual(mainTranscript);
    expect(loaded?.snapshot.history.currentBranchId).toBe("branch-3");
    expect(loaded?.snapshot.history.currentCheckpointId)
      .toBe("run-second-fork:checkpoint:1");
  });

  test("persists unique branch labels without changing stable identity", async () => {
    const { session, store } = await _settledSession("session-label");
    const renamed = await store.commit({
      sessionId: "session-label",
      expectedVersion: session.version,
      mutations: [{
        type: "renameBranch",
        branchId: "branch-1",
        label: "  Investigation  "
      }]
    });
    expect(renamed.snapshot.history.branches[0]).toMatchObject({
      id: "branch-1",
      ordinal: 1,
      label: "Investigation"
    });
    expect(renamed.snapshot.runs).toEqual(session.snapshot.runs);
    expect(renamed.journal.at(-1)).toMatchObject({
      type: "runtimeBranchRenamed",
      branchId: "branch-1",
      label: "Investigation"
    });
  });

  test("records a validated compaction without deleting original messages", async () => {
    const store = new InMemorySessionStore();
    const messages = [_user("old"), _assistant("recent"), _user("next")];
    const started = await store.commit({
      sessionId: "session-compaction",
      expectedVersion: null,
      mutations: [_start("run-compact", messages)]
    });
    const run = started.snapshot.runs[0]!;
    const path = runtimeHistoryMessagePath(
      started.snapshot.history,
      run.inputHeadEntryId
    );
    const summary = "## Goal\nContinue the durable test.";
    const compacted = await store.commit({
      sessionId: "session-compaction",
      expectedVersion: started.version,
      mutations: [{
        type: "recordCompaction",
        runId: run.id,
        firstKeptEntryId: path[1]!.id,
        summary,
        summaryFingerprint: await sha256(summary),
        requestFingerprint: "a".repeat(64),
        contextWindow: 64_000,
        tokensBefore: 50_000,
        tokensAfter: 10_000,
        usageTokens: 48_000,
        trailingTokens: 2_000,
        lastUsageMessageIndex: 1
      }]
    });

    expect(compacted.snapshot.history.entries).toEqual(
      started.snapshot.history.entries
    );
    expect(compacted.snapshot.history.compactions).toEqual([
      expect.objectContaining({
        id: "run-compact:compaction:1",
        branchId: "branch-1",
        firstKeptEntryId: path[1]!.id,
        sourceHeadEntryId: run.inputHeadEntryId,
        summary
      })
    ]);
  });

  test("rejects V3 without mutating the stored record", () => {
    const v3 = {
      version: 1,
      snapshot: {
        schemaVersion: 3,
        id: "session-v3",
        activeRunId: null,
        runs: []
      },
      configurations: [],
      journal: []
    };
    const before = structuredClone(v3);
    expect(() => new InMemorySessionStore([
      v3 as unknown as StoredRuntimeSession
    ])).toThrow(UnsupportedRuntimeSessionSchemaError);
    expect(v3).toEqual(before);
  });

  test("rejects an execution base outside the selected branch", async () => {
    const { session, store } = await _settledSession("session-invalid-base");
    expect(store.commit({
      sessionId: "session-invalid-base",
      expectedVersion: session.version,
      mutations: [{
        ..._start("run-invalid", [_user("invalid")]),
        workingBase: {
          branchId: "missing-branch",
          checkpointId: session.snapshot.history.currentCheckpointId!
        }
      }]
    })).rejects.toBeInstanceOf(SessionStoreInvariantError);
  });
});

async function _settledSession(sessionId: string): Promise<{
  readonly session: StoredRuntimeSession;
  readonly store: InMemorySessionStore;
}> {
  const store = new InMemorySessionStore();
  const input = [_user("base")];
  const started = await store.commit({
    sessionId,
    expectedVersion: null,
    mutations: [_start("run-base", input)]
  });
  const session = await store.commit({
    sessionId,
    expectedVersion: started.version,
    mutations: [
      _transition("run-base", "completed"),
      _checkpoint("run-base", [...input, _assistant("done")], "base")
    ]
  });
  return { session, store };
}

function _start(
  runId: string,
  messages: ReadonlyArray<ReturnType<typeof _assistant | typeof _user>>
): Extract<RuntimeSessionMutation, { type: "startRun"; }> {
  return {
    type: "startRun",
    runId,
    configuration: _configuration(`configuration-${runId}`),
    messages
  };
}

function _checkpoint(
  runId: string,
  messages: ReadonlyArray<ReturnType<typeof _assistant | typeof _user>>,
  continuationFingerprint: string
): Extract<RuntimeSessionMutation, { type: "recordCheckpoint"; }> {
  return {
    type: "recordCheckpoint",
    runId,
    messages,
    continuationFingerprint
  };
}

function _transition(
  runId: string,
  to: "completed"
): Extract<RuntimeSessionMutation, { type: "transitionRun"; }> {
  return { type: "transitionRun", runId, to };
}

function _configuration(id: string): RuntimeRunConfigurationSnapshot {
  return {
    id,
    agentSnapshotFingerprint: "agent",
    contextFingerprint: `context-${id}`,
    executionMode: "react",
    model: { provider: "fake", id: "fake-model" },
    toolConfigurationFingerprint: "tools"
  };
}

function _user(text: string) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
    timestamp: 1
  };
}

function _assistant(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "fake" as const,
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp: 2
  };
}
