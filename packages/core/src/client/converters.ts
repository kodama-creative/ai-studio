import type * as pi from "@earendil-works/pi-ai";

import { formatSandboxAttachmentsForPi } from "../types/threads";

import type { PiThreadContext } from "../types/agent";
import type { Message, ModelUsage } from "../types/messages";
import type {
  SandboxAttachmentDescriptor,
  ThreadContext
} from "../types/threads";
import type { Tool } from "../types/tools";

export function convertToPiContext(
  context: ThreadContext,
  sandboxAttachments: Readonly<
    Record<string, readonly SandboxAttachmentDescriptor[]>
  > = {}
): PiThreadContext {
  const result: PiThreadContext = {
    systemPrompt: context.systemPrompt,
    messages: context.messages
      ? _convertToPiMessages(context.messages, sandboxAttachments)
      : [],
    tools: context.tools ? _convertToPiTools(context.tools) : [],
    sourceTools: context.tools ? [...context.tools] : []
  };
  return result;
}

function _convertToPiMessages(
  messages: Message[],
  sandboxAttachments: Readonly<
    Record<string, readonly SandboxAttachmentDescriptor[]>
  >
) {
  const result: pi.Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const piMessage: pi.UserMessage = {
        role: "user",
        content: _convertMessageContents(
          message,
          sandboxAttachments[message.id]
        ) as Array<pi.ImageContent | pi.TextContent>,
        timestamp: Date.now()
      };
      result.push(piMessage);
    } else if (message.role === "assistant") {
      const piMessage: pi.AssistantMessage = {
        role: "assistant",
        content: _convertMessageContents(message) as Array<pi.TextContent | pi.ThinkingContent | pi.ToolCall>,
        api: "",
        model: "",
        provider: "",
        stopReason: "stop",
        timestamp: Date.now(),
        usage: _convertUsage(message.usage)
      };
      result.push(piMessage);
    }
    if (message.role === "assistant" && message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        if (!toolCall.output) {
          continue;
        }
        result.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.input.name,
          content: toolCall.output.content,
          isError: toolCall.output.isError ?? false,
          timestamp: Date.now()
        });
      }
    }
  }
  return result;
}

/** Preserve provider usage when replaying saved assistant messages to pi. */
function _convertUsage(messageUsage: ModelUsage | undefined): pi.Usage {
  return (
    messageUsage ?? {
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
        total: 0
      }
    }
  );
}

function _convertMessageContents(
  message: Message,
  sandboxAttachments: readonly SandboxAttachmentDescriptor[] = []
): Array<pi.ImageContent | pi.TextContent | pi.ThinkingContent | pi.ToolCall> {
  if (message.role === "user") {
    const contents = message.content.map(content => {
      if (content.type === "text") {
        return { ...content } satisfies pi.TextContent;
      } else if (content.type === "image_data") {
        return {
          type: "image",
          mimeType: content.mimeType,
          data: content.data
        } satisfies pi.ImageContent;
      } else {
        throw new Error(`Unsupported content type: ${JSON.stringify(content)}`);
      }
    });
    if (sandboxAttachments.length) {
      contents.push({
        type: "text",
        text: formatSandboxAttachmentsForPi(sandboxAttachments)
      });
    }
    return contents;
  } else if (message.role === "assistant") {
    const contents: Array<pi.ImageContent | pi.TextContent | pi.ThinkingContent | pi.ToolCall> = [];
    if (message.thinking) {
      contents.push({
        type: "thinking",
        thinking: message.thinking
      } satisfies pi.ThinkingContent);
    }
    for (const content of message.content) {
      if (content.type === "text") {
        contents.push({ ...content } satisfies pi.TextContent);
      } else {
        throw new Error(`Unsupported content type: ${JSON.stringify(content)}`);
      }
    }
    for (const toolCall of message.toolCalls ?? []) {
      contents.push({
        type: "toolCall",
        id: toolCall.id,
        name: toolCall.input.name,
        arguments: toolCall.input.arguments
      } satisfies pi.ToolCall);
    }
    return contents;
  } else {
    throw new Error(`Unsupported message role: ${JSON.stringify(message)}`);
  }
}

function _convertToPiTools(tools: Tool[]): pi.Tool[] {
  if (!tools) {
    return [];
  }
  return tools.map(tool => {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    };
  });
}
