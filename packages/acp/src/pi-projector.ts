import type {
  ContentBlock,
  SessionUpdate,
  UpdateSessionNotification,
} from "@agentclientprotocol/sdk/experimental/v2";
import type {
  AgentMessage as PiAgentMessage,
  LogItem,
} from "@earendil-works/pi-agent-core";
import type { PiSessionSnapshot } from "@llm-space/pi-runtime";

/** Projects committed Pi entries and records into replay-safe ACP v2 upserts. */
export function projectPiLogItems(items: readonly LogItem[]): SessionUpdate[] {
  return items.flatMap((item) => {
    if (item.kind === "record" && item.record.type === "tool_started") {
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: item.record.toolCallId,
          name: item.record.toolName,
          title: item.record.toolName,
          status: "in_progress",
          rawInput: structuredClone(item.record.effectiveArgs),
          _meta: {
            "llm-space.dev": {
              assistantEntryId: item.record.assistantEntryId,
              resultEntryId: item.record.resultEntryId,
              replay: item.record.replay,
            },
          },
        } satisfies SessionUpdate,
      ];
    }
    if (item.kind !== "entry" || item.entry.type !== "message") return [];
    return _projectMessage(item.entry.id, item.entry.message);
  });
}

/** Maps Pi debugger state onto standard ACP lifecycle state plus extension data. */
export function projectPiSnapshotState(
  snapshot: PiSessionSnapshot
): SessionUpdate {
  const details = {
    cursor: snapshot.cursor,
    lane: snapshot.lane,
    ...(snapshot.operationId === undefined
      ? {}
      : { operationId: snapshot.operationId }),
    status: snapshot.status,
    leafId: snapshot.leafId,
    ...(snapshot.nextAction === undefined
      ? {}
      : { nextAction: structuredClone(snapshot.nextAction) }),
    ...(snapshot.suspension === undefined
      ? {}
      : { suspension: structuredClone(snapshot.suspension) }),
  };
  if (snapshot.status === "paused") {
    return {
      sessionUpdate: "state_update",
      state: "requires_action",
      _meta: { "llm-space.dev": details },
    };
  }
  return {
    sessionUpdate: "state_update",
    state: "idle",
    ..._stopReason(snapshot.status),
    _meta: { "llm-space.dev": details },
  };
}

/** Adds the durable Pi cursor to the notification transport envelope. */
export function createPiSessionNotifications(
  sessionId: string,
  fromCursor: number,
  cursor: number,
  updates: readonly SessionUpdate[]
): UpdateSessionNotification[] {
  return updates.map((update, index) => ({
    sessionId,
    update,
    // Only the final state update advances the cursor. A mid-frame disconnect
    // therefore replays every idempotent upsert before that commit barrier.
    _meta: {
      "llm-space.dev": {
        cursor: index === updates.length - 1 ? cursor : fromCursor,
      },
    },
  }));
}

/** Creates the transient ACP running state used only while an effect is live. */
export function createRunningStateUpdate(): SessionUpdate {
  return { sessionUpdate: "state_update", state: "running" };
}

/** Preserves Pi entry/tool identities so full replay folds idempotently. */
function _projectMessage(
  entryId: string,
  message: PiAgentMessage
): SessionUpdate[] {
  if (message.role === "user") {
    return [
      {
        sessionUpdate: "user_message",
        messageId: entryId,
        content: _messageContent(message.content),
      },
    ];
  }
  if (message.role === "toolResult") {
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: message.toolCallId,
        name: message.toolName,
        title: message.toolName,
        status: message.isError ? "failed" : "completed",
        content: _messageContent(message.content).map((content) => ({
          type: "content" as const,
          content,
        })),
        ...(message.details === undefined
          ? {}
          : { rawOutput: structuredClone(message.details) }),
        _meta: { "llm-space.dev": { resultEntryId: entryId } },
      },
    ];
  }
  if (message.role !== "assistant") return [];

  const visible = message.content.flatMap((content) =>
    content.type === "text" ? [_contentBlock(content)] : []
  );
  const thinking = message.content.flatMap((content) =>
    content.type === "thinking"
      ? [{ type: "text" as const, text: content.thinking }]
      : []
  );
  const toolCalls = message.content.flatMap((content) =>
    content.type === "toolCall"
      ? [
          {
            sessionUpdate: "tool_call_update" as const,
            toolCallId: content.id,
            name: content.name,
            title: content.name,
            status: "pending",
            rawInput: structuredClone(content.arguments),
          } satisfies SessionUpdate,
        ]
      : []
  );
  return [
    {
      sessionUpdate: "agent_message",
      messageId: entryId,
      content: visible,
    },
    ...(thinking.length === 0
      ? []
      : [
          {
            sessionUpdate: "agent_thought" as const,
            messageId: `${entryId}:thought`,
            content: thinking,
          } satisfies SessionUpdate,
        ]),
    ...toolCalls,
  ];
}

/** Converts Pi's provider-facing text/image content into ACP content blocks. */
function _messageContent(
  content:
    | string
    | readonly (
        | { type: "text"; text: string }
        | {
            type: "image";
            data: string;
            mimeType: string;
          }
      )[]
): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map(_contentBlock);
}

/** Converts one shared text/image shape while discarding provider-only fields. */
function _contentBlock(
  content:
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        data: string;
        mimeType: string;
      }
): ContentBlock {
  return content.type === "text"
    ? { type: "text", text: content.text }
    : { type: "image", data: content.data, mimeType: content.mimeType };
}

/** Uses standard stop reasons only where Pi has an equivalent terminal state. */
function _stopReason(status: PiSessionSnapshot["status"]): {
  stopReason?: "end_turn" | "cancelled";
} {
  if (status === "completed") return { stopReason: "end_turn" };
  if (status === "aborted") return { stopReason: "cancelled" };
  return {};
}
