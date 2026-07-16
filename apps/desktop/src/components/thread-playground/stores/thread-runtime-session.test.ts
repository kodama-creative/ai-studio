import { describe, expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import {
  threadContinuationFingerprint,
  type ThreadRuntimeExecutionInput,
  ThreadRuntimeOutcomeUnknownError,
  ThreadRuntimeSession
} from "./thread-runtime-session";

describe("ThreadRuntimeSession", () => {
  test("reloads a manual wait and resumes the same Runtime Run after tool output", async () => {
    const coordinator = new ThreadRuntimeSession(undefined);
    const first = _input(_threadWithUser(), "manual");
    const begun = await coordinator.begin(first);
    const waitingThread = _threadWithToolCall();
    const settled = await coordinator.settle({
      ..._input(waitingThread, "manual"),
      runId: begun.runId,
      sawEvent: true,
      outcome: "completed"
    });
    const stillWaiting = new ThreadRuntimeSession(settled.session);
    let incompleteError: unknown;
    try {
      await stillWaiting.begin(_input(waitingThread, "manual"));
    } catch (caught) {
      incompleteError = caught;
    }
    expect((incompleteError as Error).message).toContain(
      "Complete every pending tool result"
    );
    const reloaded = new ThreadRuntimeSession(settled.session);
    const resumedThread = _threadWithToolCall("sunny");
    resumedThread.context = {
      ...resumedThread.context,
      snapshot: {
        variables: { "tool:call-one": { city: "Paris" } }
      }
    };
    const resumed = await reloaded.begin(_input(resumedThread, "manual"));

    expect(resumed.runId).toBe(begun.runId);
    expect(resumed.session.snapshot.runs.at(-1)?.state).toBe("runningModel");
    expect(resumedThread.context?.messages?.filter(message =>
      message.role === "user")).toHaveLength(1);
  });

  test("supersedes and branches only when an edited execution boundary is used", async () => {
    const coordinator = new ThreadRuntimeSession(undefined);
    const initial = _input(_threadWithUser(), "manual");
    const begun = await coordinator.begin(initial);
    const waitingThread = _threadWithToolCall();
    await coordinator.settle({
      ..._input(waitingThread, "manual"),
      runId: begun.runId,
      sawEvent: true,
      outcome: "completed"
    });
    const edited = _threadWithToolCall("sunny");
    edited.context = { ...edited.context, systemPrompt: "Changed prompt" };
    const branched = await coordinator.begin(_input(edited, "manual"));

    expect(branched.runId).not.toBe(begun.runId);
    expect(branched.session.snapshot.runs).toMatchObject([
      { id: begun.runId, state: "superseded" },
      { id: branched.runId, state: "runningModel" }
    ]);
  });

  test("branches from an earlier boundary without completing superseded tool results", async () => {
    const coordinator = new ThreadRuntimeSession(undefined);
    const begun = await coordinator.begin(_input(_threadWithUser(), "manual"));
    await coordinator.settle({
      ..._input(_threadWithToolCall(), "manual"),
      runId: begun.runId,
      sawEvent: true,
      outcome: "completed"
    });
    const earlierBoundary = _threadWithUser();
    earlierBoundary.context = {
      ...earlierBoundary.context,
      systemPrompt: "Changed prompt"
    };

    const branched = await coordinator.begin(_input(earlierBoundary, "manual"));

    expect(branched.runId).not.toBe(begun.runId);
    expect(branched.session.snapshot.runs).toMatchObject([
      { id: begun.runId, state: "superseded" },
      { id: branched.runId, state: "runningModel" }
    ]);
  });

  test("undoing an edit before execution keeps the prior continuation resumable", async () => {
    const coordinator = new ThreadRuntimeSession(undefined);
    const begun = await coordinator.begin(_input(_threadWithUser(), "manual"));
    const waitingThread = _threadWithToolCall();
    const settled = await coordinator.settle({
      ..._input(waitingThread, "manual"),
      runId: begun.runId,
      sawEvent: true,
      outcome: "completed"
    });
    const edited = _threadWithToolCall("changed");
    edited.context = { ...edited.context, systemPrompt: "temporary" };
    expect(
      await threadContinuationFingerprint(_input(edited, "manual"))
    ).not.toBe(settled.checkpoint?.continuationFingerprint);

    const undone = _threadWithToolCall("final result can be edited");
    const resumed = await coordinator.begin(_input(undone, "manual"));

    expect(resumed.runId).toBe(begun.runId);
  });

  test("maps auto-once, ReAct, failure, and abort to durable Runtime states", async () => {
    const auto = new ThreadRuntimeSession(undefined);
    const autoRun = await auto.begin(_input(_threadWithUser(), "autoOnce"));
    const autoSettled = await auto.settle({
      ..._input(_threadWithToolCall("executed"), "autoOnce"),
      runId: autoRun.runId,
      sawEvent: true,
      outcome: "completed"
    });
    expect(autoSettled.checkpoint?.state).toBe("waitingForContinue");

    const react = new ThreadRuntimeSession(undefined);
    const reactRun = await react.begin(_input(_threadWithUser(), "react"));
    const reactSettled = await react.settle({
      ..._input(_threadWithAssistant("done"), "react"),
      runId: reactRun.runId,
      sawEvent: true,
      outcome: "completed"
    });
    expect(reactSettled.checkpoint?.state).toBe("completed");

    const failed = new ThreadRuntimeSession(undefined);
    const failedRun = await failed.begin(_input(_threadWithUser(), "manual"));
    const failedSettled = await failed.settle({
      ..._input(_threadWithUser(), "manual"),
      runId: failedRun.runId,
      sawEvent: false,
      outcome: "failed"
    });
    expect(failedSettled.session.snapshot.runs.at(-1)?.state).toBe("failed");
    expect(failedSettled.checkpoint).toBeNull();

    const aborted = new ThreadRuntimeSession(undefined);
    const abortedRun = await aborted.begin(_input(_threadWithUser(), "react"));
    const abortedSettled = await aborted.settle({
      ..._input(_threadWithAssistant("partial"), "react"),
      runId: abortedRun.runId,
      sawEvent: true,
      outcome: "cancelled"
    });
    expect(abortedSettled.checkpoint?.state).toBe("cancelled");
  });

  test("terminalizes a persisted in-flight invocation instead of replaying it", async () => {
    const interrupted = new ThreadRuntimeSession(undefined);
    const started = await interrupted.begin(
      _input(_threadWithUser(), "react")
    );
    const freshProcess = new ThreadRuntimeSession(started.session);
    let error: unknown;
    try {
      await freshProcess.begin(_input(_threadWithUser(), "react"));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ThreadRuntimeOutcomeUnknownError);
    expect(error).toMatchObject({
      session: {
        snapshot: {
          activeRunId: null,
          runs: [{ id: started.runId, state: "outcomeUnknown" }]
        }
      }
    });
  });

  test("blocks malformed persisted metadata without replacing it", async () => {
    const coordinator = new ThreadRuntimeSession({ broken: true });
    expect(coordinator.loadError).toBeInstanceOf(Error);
    let error: unknown;
    try {
      await coordinator.begin(_input(_threadWithUser(), "manual"));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "Runtime Session metadata is invalid"
    );
  });
});

function _input(
  thread: Thread,
  executionMode: ThreadRuntimeExecutionInput["executionMode"]
): ThreadRuntimeExecutionInput {
  return {
    thread,
    context: thread.context ?? {},
    executionMode,
    model: thread.model!
  };
}

function _threadWithUser(): Thread {
  return {
    model: { provider: "fake", id: "model" },
    context: {
      systemPrompt: "Help",
      tools: [_tool()],
      messages: [
        {
          id: "user-one",
          role: "user",
          content: [{ type: "text", text: "Weather?" }]
        }
      ]
    }
  };
}

function _threadWithToolCall(output?: string): Thread {
  const thread = _threadWithUser();
  thread.context = {
    ...thread.context,
    messages: [
      ...thread.context!.messages!,
      {
        id: "assistant-one",
        role: "assistant",
        content: [{ type: "text", text: "Checking" }],
        toolCalls: [
          {
            id: "call-one",
            input: { name: "weather", arguments: { city: "Paris" } },
            ...(output === undefined
              ? {}
              : { output: { content: [{ type: "text", text: output }] } })
          }
        ]
      }
    ]
  };
  return thread;
}

function _threadWithAssistant(text: string): Thread {
  const thread = _threadWithUser();
  thread.context = {
    ...thread.context,
    messages: [
      ...thread.context!.messages!,
      {
        id: "assistant-done",
        role: "assistant",
        content: [{ type: "text", text }]
      }
    ]
  };
  return thread;
}

function _tool() {
  return {
    type: "function" as const,
    name: "weather",
    description: "Get weather",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } }
    }
  };
}
