import type {
  Api,
  AssistantMessage,
  Message as PiMessage,
  Model,
  Models,
  Tool,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import type { Message, ModelUsage } from "@llm-space/core";
import type {
  ModelTurnDriver,
  ModelTurnEvent,
  ModelTurnInput,
} from "@llm-space/engine";

export interface CreatePiModelTurnDriverOptions {
  readonly models: Models;
}

/** Pi implementation of one provider-neutral Engine model step. */
export function createPiModelTurnDriver(
  options: CreatePiModelTurnDriverOptions
): ModelTurnDriver {
  return new PiModelTurnDriver(options.models);
}

class PiModelTurnDriver implements ModelTurnDriver {
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
        messages: input.messages.flatMap((message) =>
          _toPiMessages(message, model)
        ),
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
      } else if (event.type === "thinking_delta") {
        yield { type: "thinking.delta", delta: event.delta };
      } else if (event.type === "toolcall_end") {
        yield {
          type: "tool.call",
          call: {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
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
          usage: _toModelUsage(event.message.usage),
          ...(event.message.responseOutputItems === undefined
            ? {}
            : { responseOutputItems: event.message.responseOutputItems }),
        };
      } else if (event.type === "error") {
        throw new Error(
          event.error.errorMessage ??
            `Pi model turn failed with reason "${event.reason}".`
        );
      }
    }
  }

  /** Resolves a pinned provider/model definition without implicit fallback. */
  private _resolveModel(definition: ModelTurnInput["model"]): Model<Api> {
    if (typeof definition !== "string") {
      throw new Error(
        "PiModelTurnDriver requires a static model string in provider/model format."
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

function _toPiMessages(message: Message, model: Model<Api>): PiMessage[] {
  if (message.role === "user") {
    return [{ role: "user", content: message.content, timestamp: 0 }];
  }
  const assistant = _toPiAssistantMessage(message, model);
  const results: ToolResultMessage[] = [];
  for (const call of message.toolCalls ?? []) {
    if (call.output === undefined) continue;
    results.push({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.input.name,
      content: call.output.content,
      details: call.output,
      isError: call.output.isError ?? false,
      timestamp: 0,
    });
  }
  return [assistant, ...results];
}

function _toPiAssistantMessage(
  message: Extract<Message, { role: "assistant" }>,
  model: Model<Api>
): AssistantMessage {
  return {
    role: "assistant",
    content: [
      ...(message.thinking === undefined
        ? []
        : [{ type: "thinking" as const, thinking: message.thinking }]),
      ...message.content,
      ...(message.toolCalls ?? []).map((call) => ({
        type: "toolCall" as const,
        id: call.id,
        name: call.input.name,
        arguments: call.input.arguments,
      })),
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: _toPiUsage(message.usage),
    stopReason: (message.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop",
    ...(message.responseOutputItems === undefined
      ? {}
      : { responseOutputItems: message.responseOutputItems }),
    ...(message.providerHostedToolActivities === undefined
      ? {}
      : { nativeToolActivities: message.providerHostedToolActivities }),
    timestamp: 0,
  };
}

function _toPiUsage(usage: ModelUsage | undefined): Usage {
  return usage ?? _emptyUsage();
}

function _toModelUsage(usage: Usage): ModelUsage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
    totalTokens: usage.totalTokens,
    cost: {
      input: usage.cost.input,
      output: usage.cost.output,
      cacheRead: usage.cost.cacheRead,
      cacheWrite: usage.cost.cacheWrite,
      total: usage.cost.total,
    },
  };
}

function _emptyUsage(): Usage {
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
