import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  Message,
  ModelUsage,
  ToolCallOutput,
  UserMessage,
} from "@llm-space/core";

/**
 * Verifies that an ACP prompt names the same user content already saved in the
 * Studio Draft. ACP is a transport boundary; Studio remains responsible for
 * selecting which editable message is admitted into the Pi Session.
 */
export function assertPiPromptMatchesCoreUserMessage(
  prompt: readonly AgentMessage[],
  message: UserMessage
): void {
  const actual = prompt.length === 1 ? prompt[0] : undefined;
  if (
    actual?.role !== "user" ||
    JSON.stringify(_promptContent(actual.content)) !==
      JSON.stringify(_corePromptContent(message))
  ) {
    throw new Error(
      `ACP prompt content does not match Studio user Message "${message.id}".`
    );
  }
}

/** Projects stable Pi message-entry identities into the editor-only Thread model. */
export function piEntriesToCoreMessages(
  entries: readonly Extract<Entry, { type: "message" }>[]
): Message[] {
  const messages: Message[] = [];
  const tools = new Map<string, { messageIndex: number; toolIndex: number }>();
  for (const entry of entries) {
    const message = entry.message;
    if (message.role === "user") {
      messages.push({
        id: entry.id,
        role: "user",
        content:
          typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : message.content.map((item) => ({ ...item })),
      });
      continue;
    }
    if (message.role === "assistant") {
      const projected = _assistant(entry.id, message);
      const messageIndex = messages.length;
      messages.push(projected);
      projected.toolCalls?.forEach((call, toolIndex) => {
        tools.set(call.id, { messageIndex, toolIndex });
      });
      continue;
    }
    if (message.role !== "toolResult") continue;
    const target = tools.get(message.toolCallId);
    if (target === undefined) continue;
    const assistant = messages[target.messageIndex];
    if (assistant?.role !== "assistant" || assistant.toolCalls === undefined) {
      continue;
    }
    const calls = assistant.toolCalls.map((call, index) =>
      index === target.toolIndex
        ? {
            ...call,
            output: {
              content: message.content.map((item) => ({ ...item })),
              isError: message.isError,
            } satisfies ToolCallOutput,
          }
        : call
    );
    messages[target.messageIndex] = { ...assistant, toolCalls: calls };
  }
  return messages;
}

/** Expands the editor's embedded tool results into canonical Pi messages. */
export function coreMessagesToPi(
  messages: readonly Message[],
  model: { readonly provider: string; readonly modelId: string },
  timestamp: number = Date.now()
): AgentMessage[] {
  return messages.flatMap((message): AgentMessage[] => {
    if (message.role === "user") {
      return [
        {
          role: "user",
          content: message.content.map((item) => ({ ...item })),
          timestamp,
        },
      ];
    }
    const assistant: PiAssistantMessage = {
      role: "assistant",
      content: [
        ...(message.thinking === undefined
          ? []
          : [{ type: "thinking" as const, thinking: message.thinking }]),
        ...message.content.map((item) => ({ ...item })),
        ...(message.toolCalls ?? []).map((call) => ({
          type: "toolCall" as const,
          id: call.id,
          name: call.input.name,
          arguments: structuredClone(call.input.arguments),
        })),
      ],
      api: "openai-responses",
      provider: model.provider,
      model: model.modelId,
      usage: message.usage ?? _emptyUsage(),
      stopReason: message.toolCalls?.length ? "toolUse" : "stop",
      timestamp,
    };
    return [
      assistant,
      ...(message.toolCalls ?? []).flatMap((call): AgentMessage[] =>
        call.output === undefined
          ? []
          : [
              {
                role: "toolResult",
                toolCallId: call.id,
                toolName: call.input.name,
                content: call.output.content.map((item) => ({ ...item })),
                isError: call.output.isError ?? false,
                timestamp,
              },
            ]
      ),
    ];
  });
}

/** Normalizes Pi's equivalent string/part-list user content forms. */
function _promptContent(
  content: Extract<AgentMessage, { role: "user" }>["content"]
): string | readonly unknown[] {
  if (typeof content === "string") return content;
  return content.map((item) =>
    item.type === "text"
      ? { type: "text", text: item.text }
      : { type: "image", data: item.data, mimeType: item.mimeType }
  );
}

/** Mirrors the official ACP adapter's all-text compaction semantics. */
function _corePromptContent(message: UserMessage): string | readonly unknown[] {
  if (message.content.every((item) => item.type === "text")) {
    return message.content
      .map((item) => (item.type === "text" ? item.text : ""))
      .join("\n");
  }
  return message.content.map((item) =>
    item.type === "text"
      ? { type: "text", text: item.text }
      : { type: "image", data: item.data, mimeType: item.mimeType }
  );
}

/** Converts one Pi assistant entry without inventing a second message identity. */
function _assistant(id: string, message: PiAssistantMessage): AssistantMessage {
  const thinking = message.content
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("");
  const toolCalls = message.content.flatMap((item) =>
    item.type === "toolCall"
      ? [
          {
            id: item.id,
            input: {
              name: item.name,
              arguments: structuredClone(item.arguments),
            },
          },
        ]
      : []
  );
  return {
    id,
    role: "assistant",
    content: message.content.flatMap((item) =>
      item.type === "text" ? [{ type: "text" as const, text: item.text }] : []
    ),
    ...(thinking.length === 0 ? {} : { thinking }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    usage: structuredClone(message.usage),
  };
}

/** Supplies Pi's required accounting shape for an imported UI-only message. */
function _emptyUsage(): ModelUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}
