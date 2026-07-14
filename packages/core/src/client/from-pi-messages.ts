import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

import type {
  AssistantMessage,
  Message,
  ModelUsage,
  ToolCall,
} from "../types/messages";
import { uuid } from "../utils";

/** Project a Pi transcript back into the durable LLM Space Thread shape. */
export function convertFromPiMessages(
  messages: AgentMessage[],
  existing: Message[] = []
): Message[] {
  const result: Message[] = [];
  const toolCallOwners = new Map<string, number>();
  let visibleIndex = 0;

  for (const message of messages) {
    if (message.role === "user") {
      const previous = existing[visibleIndex];
      const content =
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content.map((item) =>
              item.type === "text"
                ? { type: "text" as const, text: item.text }
                : {
                    type: "image_data" as const,
                    mimeType: item.mimeType,
                    data: item.data,
                  }
            );
      result.push({
        id: previous?.role === "user" ? previous.id : uuid(),
        role: "user",
        content,
      });
      visibleIndex += 1;
      continue;
    }

    if (message.role === "assistant") {
      const previous = existing[visibleIndex];
      const textContent = message.content
        .filter((content) => content.type === "text")
        .map((content) => ({ type: "text" as const, text: content.text }));
      const toolCalls = message.content
        .filter((content) => content.type === "toolCall")
        .map((content): ToolCall => ({
          id: content.id,
          input: {
            name: content.name,
            arguments: _arguments(content.arguments),
          },
        }));
      const assistant: AssistantMessage = {
        id: previous?.role === "assistant" ? previous.id : uuid(),
        role: "assistant",
        content:
          textContent.length > 0 ? textContent : [{ type: "text", text: "" }],
        ...(message.content.some((content) => content.type === "thinking")
          ? {
              thinking: message.content
                .filter((content) => content.type === "thinking")
                .map((content) => content.thinking)
                .join("\n"),
            }
          : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(_modelUsage(message.usage) ??
          (previous?.role === "assistant" && previous.usage
            ? { usage: previous.usage }
            : {})),
      };
      const ownerIndex = result.length;
      for (const call of toolCalls) toolCallOwners.set(call.id, ownerIndex);
      result.push(assistant);
      visibleIndex += 1;
      continue;
    }

    if (message.role === "toolResult") {
      const ownerIndex = toolCallOwners.get(message.toolCallId);
      if (ownerIndex === undefined) continue;
      const owner = result[ownerIndex];
      if (owner?.role !== "assistant") continue;
      result[ownerIndex] = {
        ...owner,
        toolCalls: owner.toolCalls?.map((call) =>
          call.id === message.toolCallId
            ? {
                ...call,
                output: {
                  content: message.content
                    .filter((content) => content.type === "text")
                    .map((content) => ({ type: "text", text: content.text })),
                  ...(message.isError ? { isError: true } : {}),
                },
              }
            : call
        ),
      };
    }
  }

  return result;
}

function _arguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function _modelUsage(usage: Usage): { usage: ModelUsage } | undefined {
  const reasoning = _optionalNumber(usage.reasoning);
  const input = _number(usage.input);
  const output = _number(usage.output);
  const cacheRead = _number(usage.cacheRead);
  const cacheWrite = _number(usage.cacheWrite);
  const normalized: ModelUsage = {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: _number(
      usage.totalTokens || input + output + cacheRead + cacheWrite
    ),
    cost: {
      input: _number(usage.cost.input),
      output: _number(usage.cost.output),
      cacheRead: _number(usage.cost.cacheRead),
      cacheWrite: _number(usage.cost.cacheWrite),
      total: _number(usage.cost.total),
    },
  };
  return normalized.totalTokens > 0 ||
    Object.values(normalized.cost).some(Boolean)
    ? { usage: normalized }
    : undefined;
}

function _number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function _optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}
