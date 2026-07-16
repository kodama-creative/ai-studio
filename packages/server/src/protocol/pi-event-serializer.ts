import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage
} from "@earendil-works/pi-ai";

type MessageContent = ImageContent | TextContent;
type AssistantContent = AssistantMessage["content"][number];

export function serializePiAgentEvent(event: AgentEvent): AgentEvent {
  try {
    return _serializePiAgentEvent(event);
  } catch (error) {
    if (error instanceof TypeError) {
      throw error;
    }
    throw new TypeError("Pi event serialization failed");
  }
}

function _serializePiAgentEvent(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case "agent_start":
    case "turn_start":
      return { type: event.type };
    case "agent_end":
      return {
        type: event.type,
        messages: event.messages.map(_message)
      };
    case "turn_end":
      return {
        type: event.type,
        message: _message(event.message),
        toolResults: event.toolResults.map(_toolResultMessage)
      };
    case "message_start":
    case "message_end":
      return { type: event.type, message: _message(event.message) };
    case "message_update":
      return {
        type: event.type,
        message: _message(event.message),
        assistantMessageEvent: _assistantMessageEvent(
          event.assistantMessageEvent
        )
      };
    case "tool_execution_start":
      return {
        type: event.type,
        toolCallId: _string(event.toolCallId),
        toolName: _string(event.toolName),
        args: _jsonValue(event.args)
      };
    case "tool_execution_update":
      return {
        type: event.type,
        toolCallId: _string(event.toolCallId),
        toolName: _string(event.toolName),
        args: _jsonValue(event.args),
        partialResult: _toolExecutionResult(event.partialResult)
      };
    case "tool_execution_end":
      return {
        type: event.type,
        toolCallId: _string(event.toolCallId),
        toolName: _string(event.toolName),
        result: _toolExecutionResult(event.result),
        isError: _boolean(event.isError)
      };
    default:
      throw new TypeError("Pi event contains an unsupported event type");
  }
}

function _message(message: AgentMessage): AgentMessage {
  if (!_record(message) || typeof message.role !== "string") {
    throw new TypeError("Pi event contains an unsupported message");
  }
  switch (message.role) {
    case "user":
      return _userMessage(message);
    case "assistant":
      return _assistantMessage(message);
    case "toolResult":
      return _toolResultMessage(message);
    case "bashExecution":
    case "branchSummary":
    case "compactionSummary":
    case "custom":
      throw new TypeError("Pi event contains an unsupported message role");
    default:
      throw new TypeError("Pi event contains an unsupported message role");
  }
}

function _userMessage(message: UserMessage): UserMessage {
  return {
    role: "user",
    content: typeof message.content === "string"
      ? message.content
      : _array(message.content).map(item =>
        _messageContent(item as MessageContent)),
    timestamp: _number(message.timestamp)
  };
}

function _assistantMessage(message: AssistantMessage): AssistantMessage {
  return {
    role: "assistant",
    content: _array(message.content).map(item =>
      _assistantContent(item as AssistantContent)),
    api: _string(message.api),
    provider: _string(message.provider),
    model: _string(message.model),
    ...(message.responseModel === undefined
      ? {}
      : { responseModel: _string(message.responseModel) }),
    usage: _usage(message.usage),
    stopReason: message.stopReason,
    ...(message.errorMessage === undefined
      ? {}
      : { errorMessage: "Agent execution failed" }),
    timestamp: _number(message.timestamp)
  };
}

function _toolResultMessage(message: ToolResultMessage): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: _string(message.toolCallId),
    toolName: _string(message.toolName),
    content: _array(message.content).map(item =>
      _messageContent(item as MessageContent)),
    ...(message.details === undefined
      ? {}
      : { details: _jsonValue(message.details) }),
    isError: _boolean(message.isError),
    timestamp: _number(message.timestamp)
  };
}

function _assistantMessageEvent(
  event: AssistantMessageEvent
): AssistantMessageEvent {
  switch (event.type) {
    case "start":
      return { type: event.type, partial: _assistantMessage(event.partial) };
    case "text_start":
    case "thinking_start":
    case "toolcall_start":
      return {
        type: event.type,
        contentIndex: _number(event.contentIndex),
        partial: _assistantMessage(event.partial)
      };
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return {
        type: event.type,
        contentIndex: _number(event.contentIndex),
        delta: _string(event.delta),
        partial: _assistantMessage(event.partial)
      };
    case "text_end":
    case "thinking_end":
      return {
        type: event.type,
        contentIndex: _number(event.contentIndex),
        content: _string(event.content),
        partial: _assistantMessage(event.partial)
      };
    case "toolcall_end":
      return {
        type: event.type,
        contentIndex: _number(event.contentIndex),
        toolCall: _toolCall(event.toolCall),
        partial: _assistantMessage(event.partial)
      };
    case "done":
      return {
        type: event.type,
        reason: event.reason,
        message: _assistantMessage(event.message)
      };
    case "error":
      return {
        type: event.type,
        reason: event.reason,
        error: _assistantMessage(event.error)
      };
    default:
      throw new TypeError("Pi event contains an unsupported message event");
  }
}

function _assistantContent(content: AssistantContent): AssistantContent {
  switch (content.type) {
    case "text":
      return { type: "text", text: _string(content.text) };
    case "thinking":
      return {
        type: "thinking",
        thinking: _string(content.thinking),
        ...(content.redacted === undefined
          ? {}
          : { redacted: _boolean(content.redacted) })
      } satisfies ThinkingContent;
    case "toolCall":
      return _toolCall(content);
    default:
      throw new TypeError("Pi event contains unsupported assistant content");
  }
}

function _messageContent(content: MessageContent): MessageContent {
  switch (content.type) {
    case "text":
      return { type: "text", text: _string(content.text) };
    case "image":
      return {
        type: "image",
        data: _string(content.data),
        mimeType: _string(content.mimeType)
      };
    default:
      throw new TypeError("Pi event contains unsupported message content");
  }
}

function _toolCall(toolCall: ToolCall): ToolCall {
  return {
    type: "toolCall",
    id: _string(toolCall.id),
    name: _string(toolCall.name),
    arguments: _jsonValue(toolCall.arguments) as Record<string, unknown>
  };
}

function _toolExecutionResult(value: unknown): unknown {
  const result = _record(value);
  return {
    content: _array(result.content).map(item =>
      _messageContent(item as MessageContent)),
    details: _jsonValue(result.details),
    ...(result.terminate === undefined
      ? {}
      : { terminate: _boolean(result.terminate) })
  };
}

function _usage(usage: Usage): Usage {
  const cost = _record(usage.cost);
  return {
    input: _number(usage.input),
    output: _number(usage.output),
    cacheRead: _number(usage.cacheRead),
    cacheWrite: _number(usage.cacheWrite),
    ...(usage.cacheWrite1h === undefined
      ? {}
      : { cacheWrite1h: _number(usage.cacheWrite1h) }),
    ...(usage.reasoning === undefined
      ? {}
      : { reasoning: _number(usage.reasoning) }),
    totalTokens: _number(usage.totalTokens),
    cost: {
      input: _number(cost.input),
      output: _number(cost.output),
      cacheRead: _number(cost.cacheRead),
      cacheWrite: _number(cost.cacheWrite),
      total: _number(cost.total)
    }
  };
}

function _jsonValue(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return _number(value);
  }
  if (!value || typeof value !== "object") {
    throw new TypeError("Pi events must contain only JSON values");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Pi events must not contain cyclic values");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.keys(value).length !== value.length
        || Reflect.ownKeys(value).some(key =>
          key !== "length"
          && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)))
      ) {
        throw new TypeError("Pi events must contain only plain JSON arrays");
      }
      return value.map(item => _jsonValue(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Pi events must contain only plain JSON objects");
    }
    if (Reflect.ownKeys(value).some(key =>
      typeof key !== "string"
      || !Object.prototype.propertyIsEnumerable.call(value, key))) {
      throw new TypeError("Pi events must contain only enumerable string keys");
    }
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = _jsonValue(child, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function _record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Pi event contains an invalid object");
  }
  return value as Record<string, unknown>;
}

function _array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Pi event contains an invalid array");
  }
  return value;
}

function _string(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Pi event contains an invalid string");
  }
  return value;
}

function _boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("Pi event contains an invalid boolean");
  }
  return value;
}

function _number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Pi events must contain only finite JSON numbers");
  }
  return value;
}
