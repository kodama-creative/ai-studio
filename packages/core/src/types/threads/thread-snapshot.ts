import * as z from "zod";

import { isModelUsage } from "../../thread/usage";
import type {
  Message,
  MessageContent,
  ModelUsage,
  ToolCall,
} from "../messages";
import type { Tool } from "../tools";

import { normalizeThread, type Thread } from "./thread";
import { ThreadZodSchema } from "./thread-zod";

export const SHARED_DOCUMENT_KIND = "llm-space.shared-document" as const;
export const SHARED_DOCUMENT_VERSION = 1 as const;

export type SharedContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly data: string;
      readonly mimeType: string;
    };

interface SharedMessageUpdate {
  readonly sessionUpdate: "user_message" | "agent_message" | "agent_thought";
  readonly messageId: string;
  readonly content: readonly SharedContentBlock[];
  readonly _meta?: Readonly<Record<string, unknown>> | null;
}

export interface SharedToolCallUpdate {
  readonly sessionUpdate: "tool_call_update";
  readonly toolCallId: string;
  readonly name?: string | null;
  readonly title?: string | null;
  readonly status?: "pending" | "in_progress" | "completed" | "failed" | null;
  readonly content?: readonly {
    readonly type: "content";
    readonly content: SharedContentBlock;
  }[] | null;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
  readonly _meta?: Readonly<Record<string, unknown>> | null;
}

export interface SharedUsageUpdate {
  readonly sessionUpdate: "usage_update";
  readonly used: number;
  readonly size: number;
  readonly cost?: {
    readonly amount: number;
    readonly currency: string;
  } | null;
  readonly _meta?: Readonly<Record<string, unknown>> | null;
}

export type SharedSessionUpdate =
  | SharedMessageUpdate
  | SharedToolCallUpdate
  | SharedUsageUpdate;

/** Portable Agent document plus committed ACP upserts; no runtime identities. */
export interface SharedDocumentV1 {
  readonly kind: typeof SHARED_DOCUMENT_KIND;
  readonly version: typeof SHARED_DOCUMENT_VERSION;
  readonly document: {
    readonly title: string;
    readonly instructions: readonly string[];
    readonly model?: Thread["model"];
    readonly tools: readonly Tool[];
    readonly promptVariables?: NonNullable<Thread["context"]>["variables"];
    readonly variableVariants?: NonNullable<
      Thread["context"]
    >["variableVariants"];
  };
  readonly conversation: {
    readonly updates: readonly SharedSessionUpdate[];
  };
  readonly display?: {
    readonly modelName?: string;
  };
}

const CONTENT_BLOCK_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    data: z.string(),
    mimeType: z.string(),
  }),
]);

const META_SCHEMA = z.record(z.string(), z.unknown()).nullable().optional();

const SHARED_SESSION_UPDATE_SCHEMA = z.discriminatedUnion("sessionUpdate", [
  z.object({
    sessionUpdate: z.enum(["user_message", "agent_message", "agent_thought"]),
    messageId: z.string().min(1),
    content: z.array(CONTENT_BLOCK_SCHEMA),
    _meta: META_SCHEMA,
  }),
  z.object({
    sessionUpdate: z.literal("tool_call_update"),
    toolCallId: z.string().min(1),
    name: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    status: z
      .enum(["pending", "in_progress", "completed", "failed"])
      .nullable()
      .optional(),
    content: z
      .array(
        z.object({
          type: z.literal("content"),
          content: CONTENT_BLOCK_SCHEMA,
        })
      )
      .nullable()
      .optional(),
    rawInput: z.unknown().optional(),
    rawOutput: z.unknown().optional(),
    _meta: META_SCHEMA,
  }),
  z.object({
    sessionUpdate: z.literal("usage_update"),
    used: z.number().nonnegative(),
    size: z.number().nonnegative(),
    cost: z
      .object({ amount: z.number().nonnegative(), currency: z.string().min(1) })
      .nullable()
      .optional(),
    _meta: META_SCHEMA,
  }),
]);

const SHARED_DOCUMENT_SCHEMA = z.object({
  kind: z.literal(SHARED_DOCUMENT_KIND),
  version: z.literal(SHARED_DOCUMENT_VERSION),
  document: z.object({
    title: z.string(),
    instructions: z.array(z.string()),
    model: z.unknown().optional(),
    tools: z.array(z.unknown()),
    promptVariables: z.record(z.string(), z.unknown()).optional(),
    variableVariants: z.unknown().optional(),
  }),
  conversation: z.object({
    updates: z.array(SHARED_SESSION_UPDATE_SCHEMA),
  }),
  display: z.object({ modelName: z.string().optional() }).optional(),
});

/** Rejects every legacy Thread snapshot and validates the new document shape. */
export function parseSharedDocument(value: unknown): SharedDocumentV1 {
  const parsed = SHARED_DOCUMENT_SCHEMA.parse(value);
  const validated = ThreadZodSchema.parse({
    title: parsed.document.title,
    ...(parsed.document.model === undefined
      ? {}
      : { model: parsed.document.model }),
    context: {
      systemPrompt: parsed.document.instructions.join("\n\n"),
      tools: parsed.document.tools,
      ...(parsed.document.promptVariables === undefined
        ? {}
        : { variables: parsed.document.promptVariables }),
      ...(parsed.document.variableVariants === undefined
        ? {}
        : { variableVariants: parsed.document.variableVariants }),
      messages: [],
    },
  });
  return {
    kind: SHARED_DOCUMENT_KIND,
    version: SHARED_DOCUMENT_VERSION,
    document: {
      title: validated.title ?? "",
      instructions: [...parsed.document.instructions],
      ...(validated.model === undefined
        ? {}
        : { model: structuredClone(validated.model) }),
      tools: structuredClone(validated.context?.tools ?? []),
      ...(validated.context?.variables === undefined
        ? {}
        : { promptVariables: structuredClone(validated.context.variables) }),
      ...(validated.context?.variableVariants === undefined
        ? {}
        : {
            variableVariants: structuredClone(
              validated.context.variableVariants
            ),
          }),
    },
    conversation: {
      updates: parsed.conversation.updates.map((update) =>
        structuredClone(update)
      ),
    },
    ...(parsed.display === undefined
      ? {}
      : { display: structuredClone(parsed.display) }),
  };
}

/** Builds a display/edit projection without restoring any runtime identity. */
export function threadFromSharedDocument(value: unknown): Thread {
  const shared = parseSharedDocument(value);
  const messages = messagesFromSharedSessionUpdates(shared.conversation.updates);
  return normalizeThread({
    title: shared.document.title,
    ...(shared.document.model === undefined
      ? {}
      : { model: structuredClone(shared.document.model) }),
    ...(shared.display?.modelName === undefined
      ? {}
      : { modelName: shared.display.modelName }),
    context: {
      systemPrompt: shared.document.instructions.join("\n\n"),
      tools: structuredClone([...shared.document.tools]),
      ...(shared.document.promptVariables === undefined
        ? {}
        : { variables: structuredClone(shared.document.promptVariables) }),
      ...(shared.document.variableVariants === undefined
        ? {}
        : {
            variableVariants: structuredClone(
              shared.document.variableVariants
            ),
          }),
      messages,
    },
  });
}

/** Encodes an editable transcript as replay-safe committed ACP upserts. */
export function sharedSessionUpdatesFromMessages(
  source: readonly Message[]
): SharedSessionUpdate[] {
  return source.flatMap((message): SharedSessionUpdate[] => {
    if (message.role === "user") {
      return [
        {
          sessionUpdate: "user_message",
          messageId: message.id,
          content: message.content.map(_sharedContent),
        },
      ];
    }
    const updates: SharedSessionUpdate[] = [
      {
        sessionUpdate: "agent_message",
        messageId: message.id,
        content: message.content
          .filter((content) => content.type === "text")
          .map(_sharedContent),
        ...(message.usage === undefined
          ? {}
          : {
              _meta: {
                "llm-space.dev": {
                  usage: structuredClone(message.usage),
                },
              },
            }),
      },
    ];
    if (message.thinking !== undefined) {
      updates.push({
        sessionUpdate: "agent_thought",
        messageId: `${message.id}:thought`,
        content: [{ type: "text", text: message.thinking }],
      });
    }
    for (const call of message.toolCalls ?? []) {
      updates.push({
        sessionUpdate: "tool_call_update",
        toolCallId: call.id,
        name: call.input.name,
        title: call.input.name,
        status:
          call.output === undefined
            ? "pending"
            : call.output.isError
              ? "failed"
              : "completed",
        rawInput: structuredClone(call.input.arguments),
        ...(call.output === undefined
          ? {}
          : {
              content: call.output.content.map((content) => ({
                type: "content" as const,
                content: _sharedContent(content),
              })),
            }),
        _meta: { "llm-space.dev": { assistantEntryId: message.id } },
      });
    }
    return updates;
  });
}

/** Reconstructs editor messages from committed ACP upserts only. */
export function messagesFromSharedSessionUpdates(
  updates: readonly SharedSessionUpdate[]
): Message[] {
  const messages = new Map<string, Message>();
  const order: string[] = [];
  const thoughts = new Map<string, string>();
  const tools = new Map<
    string,
    {
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: ToolCall["output"];
      assistantEntryId?: string;
    }
  >();
  for (const update of updates) {
    if (
      update.sessionUpdate === "user_message" ||
      update.sessionUpdate === "agent_message"
    ) {
      const id = update.messageId;
      if (!messages.has(id)) order.push(id);
      const content = _messageContent(update.content);
      const usage =
        update.sessionUpdate === "agent_message"
          ? _assistantUsage(update._meta)
          : undefined;
      messages.set(
        id,
        update.sessionUpdate === "user_message"
          ? { id, role: "user", content }
          : {
              id,
              role: "assistant",
              content: content.flatMap((item) =>
                item.type === "text" ? [item] : []
              ),
              ...(usage === undefined ? {} : { usage }),
            }
      );
      continue;
    }
    if (update.sessionUpdate === "agent_thought") {
      thoughts.set(update.messageId, _text(update.content));
      continue;
    }
    if (update.sessionUpdate === "tool_call_update") {
      const id = update.toolCallId;
      const current = tools.get(id);
      tools.set(id, {
        id,
        name:
          typeof update.name === "string"
            ? update.name
            : (current?.name ?? "tool"),
        input: _record(update.rawInput) ?? current?.input ?? {},
        ...(current?.output === undefined ? {} : { output: current.output }),
        ...(current?.assistantEntryId === undefined
          ? {}
          : { assistantEntryId: current.assistantEntryId }),
        ...(_toolOutput(update) === undefined
          ? {}
          : { output: _toolOutput(update) }),
        ...(_assistantEntryId(update._meta) === undefined
          ? {}
          : { assistantEntryId: _assistantEntryId(update._meta) }),
      });
    }
  }
  for (const [id, message] of messages) {
    if (message.role !== "assistant") continue;
    const thought = thoughts.get(`${id}:thought`);
    const toolCalls = [...tools.values()].flatMap((tool) =>
      tool.assistantEntryId === id
        ? [
            {
              id: tool.id,
              input: { name: tool.name, arguments: tool.input },
              ...(tool.output === undefined ? {} : { output: tool.output }),
            } satisfies ToolCall,
          ]
        : []
    );
    messages.set(id, {
      ...message,
      ...(thought === undefined ? {} : { thinking: thought }),
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
    });
  }
  return order.flatMap((id) => {
    const message = messages.get(id);
    return message === undefined ? [] : [message];
  });
}

function _sharedContent(content: MessageContent): SharedContentBlock {
  return content.type === "text"
    ? { type: "text", text: content.text }
    : { type: "image", data: content.data, mimeType: content.mimeType };
}

function _messageContent(value: unknown): MessageContent[] {
  if (!Array.isArray(value)) return [];
  const result: MessageContent[] = [];
  for (const item of value as unknown[]) {
    const content = _record(item);
    if (content?.type === "text" && typeof content.text === "string") {
      result.push({ type: "text", text: content.text });
      continue;
    }
    if (
      content?.type === "image" &&
      typeof content.data === "string" &&
      typeof content.mimeType === "string"
    ) {
      result.push({
        type: "image",
        data: content.data,
        mimeType: content.mimeType,
      });
    }
  }
  return result;
}

function _text(value: unknown): string {
  return _messageContent(value)
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("");
}

function _toolOutput(
  update: SharedToolCallUpdate
): ToolCall["output"] | undefined {
  if (update.status !== "completed" && update.status !== "failed") {
    return undefined;
  }
  const content = Array.isArray(update.content)
    ? update.content.flatMap((item) => {
        const wrapper = _record(item);
        return wrapper?.type === "content"
          ? _messageContent([wrapper.content])
          : [];
      })
    : [];
  return {
    content,
    ...(update.status === "failed" ? { isError: true } : {}),
  };
}

function _assistantEntryId(value: unknown): string | undefined {
  const meta = _record(value);
  const namespace = _record(meta?.["llm-space.dev"]);
  return typeof namespace?.assistantEntryId === "string"
    ? namespace.assistantEntryId
    : undefined;
}

function _assistantUsage(value: unknown): ModelUsage | undefined {
  const meta = _record(value);
  const namespace = _record(meta?.["llm-space.dev"]);
  if (namespace === undefined || !("usage" in namespace)) return undefined;
  if (!isModelUsage(namespace.usage)) {
    throw new Error("Committed ACP agent message contains invalid model usage.");
  }
  return structuredClone(namespace.usage);
}

function _record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
