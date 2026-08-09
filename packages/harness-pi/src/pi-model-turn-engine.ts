import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  Models,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ToolModelOutput } from "@llm-space/agent/tools";
import type {
  HarnessAssistantMessage,
  HarnessMessage,
  HarnessToolMessage,
  ModelTurnEngine,
  ModelTurnEvent,
  ModelTurnInput,
} from "@llm-space/harness";

export interface CreatePiModelTurnEngineOptions {
  readonly models: Models;
}

class PiModelTurnEngine implements ModelTurnEngine {
  constructor(private readonly _models: Models) {}

  async *run(
    input: ModelTurnInput,
    options: { readonly signal: AbortSignal }
  ): AsyncIterable<ModelTurnEvent> {
    const model = this._resolveModel(input.model);
    const stream = this._models.streamSimple(
      model,
      {
        systemPrompt: input.instructions.join("\n\n"),
        messages: input.messages.map((message) => _toPiMessage(message, model)),
        tools: input.tools.map((tool): Tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      },
      { signal: options.signal }
    );

    for await (const event of stream) {
      if (event.type === "text_delta") {
        yield { type: "text.delta", delta: event.delta };
      } else if (event.type === "toolcall_end") {
        yield {
          type: "tool.call",
          call: {
            id: event.toolCall.id,
            name: event.toolCall.name,
            input: event.toolCall.arguments,
          },
        };
      } else if (event.type === "done") {
        yield {
          type: "finish",
          reason:
            event.reason === "toolUse"
              ? "tool-calls"
              : event.reason === "stop" || event.reason === "length"
                ? event.reason
                : "other",
        };
      } else if (event.type === "error") {
        throw new Error(
          event.error.errorMessage ??
            `Pi model turn failed with reason "${event.reason}".`
        );
      }
    }
  }

  private _resolveModel(definition: ModelTurnInput["model"]): Model<Api> {
    if (typeof definition !== "string") {
      throw new Error(
        "PiModelTurnEngine currently requires a static model string in provider/model format."
      );
    }
    const separator = definition.indexOf("/");
    if (separator <= 0 || separator === definition.length - 1) {
      throw new Error(
        `Pi model "${definition}" must use provider/model format.`
      );
    }
    const provider = definition.slice(0, separator);
    const modelId = definition.slice(separator + 1);
    const model = this._models.getModel(provider, modelId);
    if (model === undefined) {
      throw new Error(`Pi model "${definition}" was not found.`);
    }
    return model;
  }
}

export function createPiModelTurnEngine(
  options: CreatePiModelTurnEngineOptions
): ModelTurnEngine {
  return new PiModelTurnEngine(options.models);
}

function _toPiMessage(message: HarnessMessage, model: Model<Api>): Message {
  if (message.role === "user") {
    return { role: "user", content: message.content, timestamp: 0 };
  }
  if (message.role === "tool") return _toPiToolResult(message);
  return _toPiAssistantMessage(message, model);
}

function _toPiAssistantMessage(
  message: HarnessAssistantMessage,
  model: Model<Api>
): AssistantMessage {
  return {
    role: "assistant",
    content: [
      ...(message.content.length === 0
        ? []
        : [{ type: "text" as const, text: message.content }]),
      ...message.toolCalls.map((call) => ({
        type: "toolCall" as const,
        id: call.id,
        name: call.name,
        arguments: _asArgumentRecordOrEmpty(call.input),
      })),
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: _emptyUsage(),
    stopReason: message.toolCalls.length > 0 ? "toolUse" : "stop",
    timestamp: 0,
  };
}

function _toPiToolResult(message: HarnessToolMessage): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: message.callId,
    toolName: message.name,
    content: _toPiToolContent(message.output),
    details: message.output,
    isError: message.isError,
    timestamp: 0,
  };
}

function _toPiToolContent(
  output: ToolModelOutput
): (TextContent | ImageContent)[] {
  if (output.type === "text") return [{ type: "text", text: output.value }];
  if (output.type === "json") {
    return [{ type: "text", text: JSON.stringify(output.value) ?? "null" }];
  }
  return output.value.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.mediaType.startsWith("image/")) {
      return {
        type: "image",
        data: part.data.data,
        mimeType: part.mediaType,
      };
    }
    throw new Error(
      `PiModelTurnEngine cannot represent tool file output with media type "${part.mediaType}".`
    );
  });
}

function _asArgumentRecordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function _emptyUsage(): AssistantMessage["usage"] {
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
