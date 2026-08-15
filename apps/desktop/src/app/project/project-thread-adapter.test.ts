import { expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";
import type { PiSessionSnapshot } from "@llm-space/pi-runtime";
import type { StudioRunHistoryEntry, StudioThread } from "@llm-space/studio";

import type { StudioTransport } from "@/shared/studio-rpc";
import type { ThreadClient } from "@/shared/thread-rpc";

import {
  createProjectThreadExecutionRuntime,
  playgroundThreadToStudioEvaluationMetadata,
  shouldPersistProjectThread,
  studioThreadToPlaygroundThread,
} from "./project-thread-adapter";

const USER = {
  id: "user-1",
  role: "user" as const,
  content: [{ type: "text" as const, text: "hello" }],
};

test("projects Pi operation history and evaluation ids to editor run vocabulary", () => {
  const thread = _thread();
  const history: StudioRunHistoryEntry[] = [
    {
      reference: {
        sessionId: thread.sessionId,
        lane: "main",
        operationId: "operation-1",
        leafId: "leaf-1",
        agentSnapshot: thread.document.agent,
        relation: "executed",
      },
      operation: {
        sessionId: thread.sessionId,
        lane: "main",
        operationId: "operation-1",
        status: "completed",
        sourceLeafId: null,
        leafId: "leaf-1",
        conversationEntries: [],
        messageEntries: [],
        startedAt: 1,
        finishedAt: 2,
      },
      checkpoint: {
        schemaVersion: 1,
        id: "leaf-1",
        sessionId: thread.sessionId,
        operationId: "operation-1",
        document: thread.document,
        createdAt: 2,
      },
    },
  ];
  const projected = studioThreadToPlaygroundThread(thread, history, {
    evaluations: [
      {
        schemaVersion: 1,
        id: "evaluation-1",
        threadId: thread.id,
        leftOperationId: "operation-1",
        rightOperationId: "operation-2",
        verdict: "leftBetter",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    rubrics: [],
  });

  expect(projected.runHistory).toMatchObject([{ id: "operation-1" }]);
  expect(projected.evaluations).toMatchObject([
    { leftRunId: "operation-1", rightRunId: "operation-2" },
  ]);
  expect(playgroundThreadToStudioEvaluationMetadata(projected)).toMatchObject({
    evaluations: [
      {
        leftOperationId: "operation-1",
        rightOperationId: "operation-2",
      },
    ],
  });
});

test("Project execution saves metadata then uses Thread RPC run and Step", async () => {
  let thread = _thread();
  const calls: string[] = [];
  let nextKind: "tool" | "model" = "tool";
  const client = _client({
    saveDocument: (_id, document) => {
      calls.push("metadata.save");
      thread = { ...thread, document };
      return Promise.resolve(thread);
    },
    loadThread: () => Promise.resolve(thread),
  });
  const runtime = createProjectThreadExecutionRuntime({
    client,
    projectId: "project-1",
    threadId: thread.id,
    getThread: () => thread,
    onThread: (next) => {
      thread = next;
    },
    threadClient: _threadClient({
      run: () => {
        calls.push("thread.run");
        thread = { ...thread, operationId: "operation-1" };
        return Promise.resolve({
          sessionId: thread.sessionId,
          operationId: "operation-1",
        });
      },
      inspect: () => {
        calls.push("thread.inspect");
        return Promise.resolve(_snapshot(nextKind));
      },
      step: () => {
        calls.push("thread.step");
        nextKind = "model";
        return Promise.resolve({
          sessionId: thread.sessionId,
          operationId: "operation-1",
        });
      },
    }),
  });

  const updates: Thread[] = [];
  for await (const event of runtime.execute({
    thread: studioThreadToPlaygroundThread(thread),
    fromMessageId: USER.id,
    autoRunTools: true,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    if (event.type === "thread.updated") updates.push(event.thread);
  }

  expect(calls).toEqual([
    "metadata.save",
    "thread.run",
    "thread.inspect",
    "thread.step",
    "thread.inspect",
    "thread.inspect",
  ]);
  expect(updates).toHaveLength(1);
});

test("detects a user-authored Project Draft", () => {
  const thread = _thread();
  const projected = studioThreadToPlaygroundThread(thread);
  expect(shouldPersistProjectThread(projected, thread)).toBeFalse();
  expect(
    shouldPersistProjectThread(
      {
        ...projected,
        context: {
          ...projected.context,
          messages: [
            ...projected.context!.messages!,
            { id: "user-2", role: "user", content: [] },
          ],
        },
      },
      thread
    )
  ).toBeTrue();
});

/** Builds one Pi-backed Project Experiment projection. */
function _thread(): StudioThread {
  return {
    schemaVersion: 1,
    id: "experiment-1",
    sessionId: "session-1",
    lane: "main",
    leafId: null,
    runtimeFormatVersion: 1,
    document: {
      title: "Experiment",
      agent: {
        agentSpecId: "agent-1",
        sourceRevision: "source-1",
        model: "test/model",
        instructions: ["Answer."],
        tools: [],
      },
      conversation: { messages: [USER], state: {} },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

/** Supplies a minimal metadata-only Project transport. */
function _client(
  overrides: Partial<StudioTransport> = {}
): StudioTransport {
  const thread = _thread();
  return {
    listThreads: () => Promise.resolve([thread]),
    listRunHistory: () => Promise.resolve([]),
    saveRunHistory: () => Promise.resolve([]),
    listEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    saveEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    forkThread: () => Promise.resolve(thread),
    createThread: () => Promise.resolve(thread),
    loadThread: () => Promise.resolve(thread),
    saveDocument: () => Promise.resolve(thread),
    events: () => _emptyAsyncIterable(),
    ...overrides,
  };
}

/** Supplies a completed async stream without manufacturing test events. */
function _emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: () =>
          Promise.resolve({ done: true, value: undefined } as const),
      };
    },
  };
}

/** Returns one debugger snapshot with the requested next action kind. */
function _snapshot(kind: "model" | "tool"): PiSessionSnapshot {
  return {
    cursor: 1,
    sessionId: "session-1",
    lane: "main",
    operationId: "operation-1",
    status: "paused",
    messageEntries: [],
    messages: [],
    leafId: "leaf-1",
    nextAction:
      kind === "model"
        ? { id: "operation-1:model:2:1", kind: "model", attempt: 1 }
        : {
            id: "operation-1:tool:assistant-1:0",
            kind: "tool",
            assistantEntryId: "assistant-1",
            toolIndex: 0,
            toolCallId: "call-1",
            toolName: "lookup",
          },
  };
}

function _threadClient(
  overrides: Partial<ThreadClient> = {}
): ThreadClient {
  return {
    run: () => Promise.reject(new Error("Unexpected run.")),
    inspect: () => Promise.reject(new Error("Unexpected inspect.")),
    step: () => Promise.reject(new Error("Unexpected step.")),
    continue: () => Promise.reject(new Error("Unexpected continue.")),
    resolveToolApproval: () =>
      Promise.reject(new Error("Unexpected tool approval.")),
    cancel: () => Promise.resolve(),
    ...overrides,
  };
}
