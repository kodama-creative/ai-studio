import type {
  ContentBlock,
  SessionUpdate,
  UpdateSessionNotification,
} from "@agentclientprotocol/sdk/experimental/v2";

export type AcpMessageRole = "user" | "agent" | "thought";

export interface AcpProjectedMessage {
  readonly messageId: string;
  readonly role: AcpMessageRole;
  readonly content: readonly ContentBlock[];
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

export interface AcpProjectedToolCall {
  readonly toolCallId: string;
  readonly name?: string | null;
  readonly title?: string | null;
  readonly kind?: string | null;
  readonly status?: string | null;
  readonly content?: readonly unknown[] | null;
  readonly locations?: readonly unknown[] | null;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

export interface AcpSessionProjection {
  readonly sessionId: string;
  readonly messageOrder: readonly string[];
  readonly messages: Readonly<Record<string, AcpProjectedMessage>>;
  readonly toolCallOrder: readonly string[];
  readonly toolCalls: Readonly<Record<string, AcpProjectedToolCall>>;
  readonly state: "idle" | "running" | "requires_action";
  readonly stopReason?: string | null;
  readonly cursor: number;
  readonly meta?: Readonly<Record<string, unknown>> | null;
  readonly usage?: Readonly<{
    used: number;
    size: number;
    cost?: unknown;
  }>;
  /** Stable usage-record upserts used to make replay aggregation idempotent. */
  readonly usageRecords: Readonly<
    Record<string, { readonly used: number; readonly size: number; readonly cost?: unknown }>
  >;
}

export function createAcpSessionProjection(
  sessionId: string
): AcpSessionProjection {
  return {
    sessionId,
    messageOrder: [],
    messages: {},
    toolCallOrder: [],
    toolCalls: {},
    state: "idle",
    cursor: 0,
    usageRecords: {},
  };
}

/** Folds one standard ACP notification into the frontend's only execution view. */
export function reduceAcpSessionNotification(
  projection: AcpSessionProjection,
  notification: UpdateSessionNotification
): AcpSessionProjection {
  if (notification.sessionId !== projection.sessionId) {
    throw new Error(
      `ACP update for session "${notification.sessionId}" cannot update "${projection.sessionId}".`
    );
  }
  const next = reduceAcpSessionUpdate(projection, notification.update);
  const cursor = _cursor(notification._meta);
  return cursor === undefined || cursor < next.cursor
    ? next
    : { ...next, cursor };
}

/** Applies ACP upsert/chunk semantics without reconstructing a legacy Thread. */
export function reduceAcpSessionUpdate(
  projection: AcpSessionProjection,
  update: SessionUpdate
): AcpSessionProjection {
  switch (update.sessionUpdate) {
    case "user_message":
      return _messageUpsert(projection, update as MessageUpsert, "user");
    case "agent_message":
      return _messageUpsert(projection, update as MessageUpsert, "agent");
    case "agent_thought":
      return _messageUpsert(projection, update as MessageUpsert, "thought");
    case "user_message_chunk":
      return _messageChunk(projection, update as MessageChunk, "user");
    case "agent_message_chunk":
      return _messageChunk(projection, update as MessageChunk, "agent");
    case "agent_thought_chunk":
      return _messageChunk(projection, update as MessageChunk, "thought");
    case "tool_call_update":
      return _toolCallUpsert(projection, update as ToolCallUpsert);
    case "state_update": {
      const state = update as {
        state: AcpSessionProjection["state"];
        stopReason?: string | null;
      };
      return {
        ...projection,
        state: state.state,
        ...(Object.prototype.hasOwnProperty.call(update, "_meta")
          ? {
              meta: (update as { _meta?: Readonly<Record<string, unknown>> | null })
                ._meta,
            }
          : {}),
        ...(state.state === "idle"
          ? { stopReason: state.stopReason }
          : { stopReason: undefined }),
      };
    }
    case "usage_update": {
      const usage = update as {
        used: number;
        size: number;
        cost?: { amount?: number; currency?: string } | null;
        _meta?: Readonly<Record<string, unknown>> | null;
      };
      const recordId = _usageRecordId(usage._meta);
      if (recordId === undefined) {
        return {
          ...projection,
          usage: {
            used: usage.used,
            size: usage.size,
            ...(usage.cost === undefined ? {} : { cost: usage.cost }),
          },
        };
      }
      const usageRecords = {
        ...projection.usageRecords,
        [recordId]: {
          used: usage.used,
          size: usage.size,
          ...(usage.cost === undefined ? {} : { cost: usage.cost }),
        },
      };
      const records = Object.values(usageRecords);
      const cost = _aggregateCost(records);
      return {
        ...projection,
        usageRecords,
        usage: {
          used: records.reduce((sum, item) => sum + item.used, 0),
          size: records.reduce((sum, item) => sum + item.size, 0),
          ...(cost === undefined ? {} : { cost }),
        },
      };
    }
    default:
      return projection;
  }
}

function _usageRecordId(
  meta: Readonly<Record<string, unknown>> | null | undefined
): string | undefined {
  const namespace = meta?.["llm-space.dev"];
  if (typeof namespace !== "object" || namespace === null) return undefined;
  const id = (namespace as Readonly<Record<string, unknown>>).usageRecordId;
  return typeof id === "string" ? id : undefined;
}

function _aggregateCost(
  records: readonly { readonly cost?: unknown }[]
): { readonly amount: number; readonly currency: string } | undefined {
  const costs = records.flatMap((record) => {
    const cost = record.cost;
    if (typeof cost !== "object" || cost === null) return [];
    const value = cost as Readonly<Record<string, unknown>>;
    return typeof value.amount === "number" && typeof value.currency === "string"
      ? [{ amount: value.amount, currency: value.currency }]
      : [];
  });
  const currency = costs[0]?.currency;
  return currency === undefined || costs.some((cost) => cost.currency !== currency)
    ? undefined
    : {
        amount: costs.reduce((sum, cost) => sum + cost.amount, 0),
        currency,
      };
}

interface MessageUpsert {
  readonly messageId: string;
  readonly content?: readonly ContentBlock[] | null;
  readonly _meta?: Readonly<Record<string, unknown>> | null;
}

interface MessageChunk {
  readonly messageId: string;
  readonly content: ContentBlock;
}

interface ToolCallUpsert extends Readonly<Record<string, unknown>> {
  readonly toolCallId: string;
}

function _messageUpsert(
  projection: AcpSessionProjection,
  update: MessageUpsert,
  role: AcpMessageRole
): AcpSessionProjection {
  const existing = projection.messages[update.messageId];
  const message: AcpProjectedMessage = {
    messageId: update.messageId,
    role,
    content:
      update.content === undefined
        ? (existing?.content ?? [])
        : (update.content ?? []),
    ...(update._meta === undefined
      ? existing?.meta === undefined
        ? {}
        : { meta: existing.meta }
      : { meta: update._meta }),
  };
  return _withMessage(projection, message);
}

function _messageChunk(
  projection: AcpSessionProjection,
  update: MessageChunk,
  role: AcpMessageRole
): AcpSessionProjection {
  const existing = projection.messages[update.messageId];
  return _withMessage(projection, {
    messageId: update.messageId,
    role,
    content: [...(existing?.content ?? []), update.content],
    ...(existing?.meta === undefined ? {} : { meta: existing.meta }),
  });
}

function _withMessage(
  projection: AcpSessionProjection,
  message: AcpProjectedMessage
): AcpSessionProjection {
  const isNew = projection.messages[message.messageId] === undefined;
  return {
    ...projection,
    messageOrder: isNew
      ? [...projection.messageOrder, message.messageId]
      : projection.messageOrder,
    messages: { ...projection.messages, [message.messageId]: message },
  };
}

function _toolCallUpsert(
  projection: AcpSessionProjection,
  update: ToolCallUpsert
): AcpSessionProjection {
  const existing = projection.toolCalls[update.toolCallId];
  const next = _patch<Record<string, unknown>>(
    { ...existing, toolCallId: update.toolCallId },
    update,
    [
    "name",
    "title",
    "kind",
    "status",
    "content",
    "locations",
    "rawInput",
    "rawOutput",
    "_meta",
    ]
  );
  if (existing?.meta !== undefined && update._meta !== undefined) {
    next._meta = _mergeMeta(existing.meta, update._meta);
  }
  const toolCall: AcpProjectedToolCall = {
    toolCallId: update.toolCallId,
    ...(next.name === undefined ? {} : { name: next.name as string | null }),
    ...(next.title === undefined ? {} : { title: next.title as string | null }),
    ...(next.kind === undefined ? {} : { kind: next.kind as string | null }),
    ...(next.status === undefined
      ? {}
      : { status: next.status as string | null }),
    ...(next.content === undefined
      ? {}
      : { content: next.content as readonly unknown[] | null }),
    ...(next.locations === undefined
      ? {}
      : { locations: next.locations as readonly unknown[] | null }),
    ...(Object.prototype.hasOwnProperty.call(next, "rawInput")
      ? { rawInput: next.rawInput }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(next, "rawOutput")
      ? { rawOutput: next.rawOutput }
      : {}),
    ...(next._meta === undefined
      ? {}
      : { meta: next._meta as Readonly<Record<string, unknown>> | null }),
  };
  return {
    ...projection,
    toolCallOrder:
      existing === undefined
        ? [...projection.toolCallOrder, update.toolCallId]
        : projection.toolCallOrder,
    toolCalls: { ...projection.toolCalls, [update.toolCallId]: toolCall },
  };
}

function _mergeMeta(
  current: Readonly<Record<string, unknown>> | null,
  patch: unknown
): Readonly<Record<string, unknown>> | null {
  if (patch === null || typeof patch !== "object") {
    return patch === null ? null : current;
  }
  const next = { ...(current ?? {}), ...(patch as Record<string, unknown>) };
  const currentLlm = current?.["llm-space.dev"];
  const patchLlm = (patch as Record<string, unknown>)["llm-space.dev"];
  if (
    typeof currentLlm === "object" &&
    currentLlm !== null &&
    typeof patchLlm === "object" &&
    patchLlm !== null
  ) {
    next["llm-space.dev"] = { ...currentLlm, ...patchLlm };
  }
  return next;
}

function _patch<T extends Record<string, unknown>>(
  base: T,
  update: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): T {
  const next = { ...base };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(update, field)) {
      (next as Record<string, unknown>)[field] = update[field];
    }
  }
  return next;
}

function _cursor(
  meta: Readonly<Record<string, unknown>> | null | undefined
): number | undefined {
  const namespace = meta?.["llm-space.dev"];
  if (typeof namespace !== "object" || namespace === null) return undefined;
  const cursor = (namespace as Readonly<Record<string, unknown>>).cursor;
  return typeof cursor === "number" && Number.isInteger(cursor) && cursor >= 0
    ? cursor
    : undefined;
}
