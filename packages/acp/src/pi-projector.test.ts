import { expect, test } from "bun:test";

import type { LogItem } from "@earendil-works/pi-agent-core";
import type { PiSessionSnapshot } from "@llm-space/pi-runtime";

import {
  LLM_SPACE_ACP_METHODS,
  createLlmSpaceAgentCapabilities,
} from "./extensions";
import {
  createPiSessionNotifications,
  projectPiEphemeralEvent,
  projectPiLogItems,
  projectPiSnapshotState,
} from "./pi-projector";

test("advertises durable debug only as a negotiated ACP v2 extension", () => {
  expect(createLlmSpaceAgentCapabilities()).toEqual({
    session: {},
    _meta: {
      "llm-space.dev": {
        durableDebug: {
          version: 1,
          cursor: "pi-log-sequence",
          methods: [
            LLM_SPACE_ACP_METHODS.snapshot,
            LLM_SPACE_ACP_METHODS.step,
            LLM_SPACE_ACP_METHODS.turn,
            LLM_SPACE_ACP_METHODS.continue,
          ],
        },
      },
    },
  });
});

test("projects ephemeral deltas with the final committed message identity", () => {
  expect(
    projectPiEphemeralEvent({
      type: "assistant.text_delta",
      messageId: "assistant-1",
      delta: "hello",
    })
  ).toEqual({
    sessionUpdate: "agent_message_chunk",
    messageId: "assistant-1",
    content: { type: "text", text: "hello" },
  });
  expect(
    projectPiEphemeralEvent({
      type: "assistant.thinking_delta",
      messageId: "assistant-1",
      delta: "hmm",
    })
  ).toEqual({
    sessionUpdate: "agent_thought_chunk",
    messageId: "assistant-1:thought",
    content: { type: "text", text: "hmm" },
  });
});

test("projects stable Pi entry and tool identities into ACP v2 upserts", () => {
  const items: LogItem[] = [
    {
      kind: "entry",
      seq: 1,
      entry: {
        type: "message",
        id: "user-entry",
        seq: 1,
        parentId: null,
        timestamp: 1,
        message: { role: "user", content: "Hello", timestamp: 1 },
      },
    },
    {
      kind: "entry",
      seq: 2,
      entry: {
        type: "message",
        id: "assistant-entry",
        seq: 2,
        parentId: "user-entry",
        timestamp: 2,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Inspect first" },
            { type: "text", text: "Running it" },
            {
              type: "toolCall",
              id: "tool-call-1",
              name: "shell",
              arguments: { command: "pwd" },
            },
          ],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5",
          usage: {
            input: 1,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "toolUse",
          timestamp: 2,
        },
      },
    },
    {
      kind: "record",
      seq: 3,
      record: {
        type: "tool_started",
        id: "tool-started",
        seq: 3,
        lane: "main",
        timestamp: 3,
        runId: "run-1",
        assistantEntryId: "assistant-entry",
        toolIndex: 0,
        toolCallId: "tool-call-1",
        toolName: "shell",
        effectiveArgs: { command: "pwd" },
        resultEntryId: "tool-result-entry",
        replay: "safe",
      },
    },
    {
      kind: "entry",
      seq: 4,
      entry: {
        type: "message",
        id: "tool-result-entry",
        seq: 4,
        parentId: "assistant-entry",
        timestamp: 4,
        message: {
          role: "toolResult",
          toolCallId: "tool-call-1",
          toolName: "shell",
          content: [{ type: "text", text: "/workspace" }],
          details: { exitCode: 0 },
          isError: false,
          timestamp: 4,
        },
      },
    },
  ];

  expect(projectPiLogItems(items)).toEqual([
    {
      sessionUpdate: "user_message",
      messageId: "user-entry",
      content: [{ type: "text", text: "Hello" }],
    },
    {
      sessionUpdate: "agent_message",
      messageId: "assistant-entry",
      content: [{ type: "text", text: "Running it" }],
      _meta: {
        "llm-space.dev": {
          usage: {
            input: 1,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
      },
    },
    {
      sessionUpdate: "agent_thought",
      messageId: "assistant-entry:thought",
      content: [{ type: "text", text: "Inspect first" }],
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-call-1",
      name: "shell",
      title: "shell",
      status: "pending",
      rawInput: { command: "pwd" },
      _meta: {
        "llm-space.dev": { assistantEntryId: "assistant-entry" },
      },
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-call-1",
      name: "shell",
      title: "shell",
      status: "in_progress",
      rawInput: { command: "pwd" },
      _meta: {
        "llm-space.dev": {
          assistantEntryId: "assistant-entry",
          resultEntryId: "tool-result-entry",
          replay: "safe",
        },
      },
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-call-1",
      name: "shell",
      title: "shell",
      status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "/workspace" } },
      ],
      rawOutput: { exitCode: 0 },
      _meta: { "llm-space.dev": { resultEntryId: "tool-result-entry" } },
    },
  ]);
});

test("does not forge ACP context-window usage from Pi accounting records", () => {
  expect(
    projectPiLogItems([
      {
        kind: "record",
        seq: 1,
        record: {
          type: "usage",
          id: "usage-1",
          seq: 1,
          lane: "main",
          timestamp: 1,
          cause: "assistant",
          runId: "run-1",
          entryId: "assistant-1",
          attempt: 1,
          stopReason: "stop",
          usage: {
            input: 3,
            output: 2,
            cacheRead: 1,
            cacheWrite: 0,
            totalTokens: 6,
            cost: {
              input: 0.01,
              output: 0.02,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.03,
            },
          },
        },
      },
    ])
  ).toEqual([]);
});

test("projects debugger pause and durable cursor without inventing ACP state", () => {
  const snapshot = {
    cursor: 9,
    sessionId: "session-1",
    lane: "main",
    operationId: "run-1",
    status: "paused",
    messageEntries: [],
    messages: [],
    leafId: "assistant-entry",
    nextAction: { id: "run-1:model:1", kind: "model", attempt: 1 },
  } satisfies PiSessionSnapshot;

  expect(projectPiSnapshotState(snapshot)).toEqual({
    sessionUpdate: "state_update",
    state: "requires_action",
    _meta: {
      "llm-space.dev": {
        cursor: 9,
        lane: "main",
        operationId: "run-1",
        status: "paused",
        leafId: "assistant-entry",
        nextAction: { id: "run-1:model:1", kind: "model", attempt: 1 },
      },
    },
  });
  expect(
    createPiSessionNotifications("session-1", 4, 9, [
      {
        sessionUpdate: "agent_message",
        messageId: "assistant-entry",
        content: [{ type: "text", text: "answer" }],
      },
      projectPiSnapshotState(snapshot),
    ])
  ).toEqual([
    {
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message",
        messageId: "assistant-entry",
        content: [{ type: "text", text: "answer" }],
      },
      _meta: { "llm-space.dev": { cursor: 4 } },
    },
    {
      sessionId: "session-1",
      update: projectPiSnapshotState(snapshot),
      _meta: { "llm-space.dev": { cursor: 9 } },
    },
  ]);
});

test("projects pending Pi tool approval as ACP required action", () => {
  const snapshot = {
    cursor: 9,
    sessionId: "session-1",
    lane: "main",
    operationId: "run-1",
    status: "suspended",
    messageEntries: [],
    messages: [],
    leafId: "assistant-entry",
    suspension: {
      code: "tool_approval_required",
      message: 'Tool "shell" requires approval.',
    },
    approval: {
      toolCallId: "tool-call-1",
      toolName: "shell",
      status: "pending",
    },
  } satisfies PiSessionSnapshot;

  expect(projectPiSnapshotState(snapshot)).toMatchObject({
    sessionUpdate: "state_update",
    state: "requires_action",
    _meta: {
      "llm-space.dev": {
        status: "suspended",
        approval: {
          toolCallId: "tool-call-1",
          toolName: "shell",
          status: "pending",
        },
      },
    },
  });
});

test("ends a standard ACP turn when Pi suspends on unavailable runtime identity", () => {
  const snapshot = {
    cursor: 3,
    sessionId: "session-1",
    lane: "main",
    operationId: "run-1",
    status: "suspended",
    messageEntries: [],
    messages: [],
    leafId: null,
    suspension: {
      code: "missing_model_identity",
      message: "The frozen model is unavailable.",
    },
  } satisfies PiSessionSnapshot;

  expect(projectPiSnapshotState(snapshot)).toMatchObject({
    sessionUpdate: "state_update",
    state: "idle",
    _meta: {
      "llm-space.dev": {
        status: "suspended",
        suspension: {
          code: "missing_model_identity",
        },
      },
    },
  });
});
