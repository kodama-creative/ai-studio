import {
  runAgentLoopContinue,
  type AgentContext,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage as PiAssistantMessage,
  Message as PiMessage,
  Model,
  Models,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import type { ToolDefinition, ToolModelOutput } from "@llm-space/agent/tools";
import type {
  AssistantMessage,
  Message,
  ModelUsage,
  ToolCallOutput,
} from "@llm-space/core";
import type {
  ModelToolDefinition,
  RunExecutionInput,
  RunExecutionSink,
  RunExecutor,
} from "@llm-space/engine";

import { validateSchemaValue } from "./schema-validation";

export interface CreatePiRunExecutorOptions {
  readonly models: Models;
}

/** Creates a Pi-backed executor for one complete Engine Run. */
export function createPiRunExecutor(
  options: CreatePiRunExecutorOptions
): RunExecutor {
  return new PiRunExecutor(options.models);
}

class PiRunExecutor implements RunExecutor {
  constructor(private readonly _models: Models) {}

  /** Runs Pi's complete ReAct loop and awaits every Engine persistence event. */
  async execute(
    input: RunExecutionInput,
    sink: RunExecutionSink,
    options: { readonly signal: AbortSignal }
  ): Promise<void> {
    const model = this._resolveModel(input.agent.snapshot.model);
    let turnIndex = -1;
    const context: AgentContext = {
      systemPrompt: input.agent.snapshot.instructions.join("\n\n"),
      messages: input.messages.flatMap((message) =>
        _toPiMessages(message, model)
      ),
      tools: input.agent.snapshot.tools.map((tool) =>
        _toPiTool(tool, input, options.signal, () => Math.max(turnIndex, 0))
      ),
    };
    let currentAssistant: AssistantMessage | undefined;
    let lastPiAssistant: PiAssistantMessage | undefined;
    let turnLimitExceeded = false;

    const emit = async (event: AgentEvent): Promise<void> => {
      if (event.type === "turn_start") {
        turnIndex++;
        return;
      }
      if (
        event.type === "message_start" &&
        event.message.role === "assistant"
      ) {
        currentAssistant = _fromPiAssistant(
          event.message,
          input.createMessageId()
        );
        lastPiAssistant = event.message;
        return;
      }
      if (
        event.type === "message_update" &&
        event.message.role === "assistant"
      ) {
        currentAssistant = _fromPiAssistant(
          event.message,
          _requireAssistant(currentAssistant).id
        );
        lastPiAssistant = event.message;
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          await sink.accept({
            type: "assistant.delta",
            message: currentAssistant,
            textDelta: update.delta,
          });
        } else if (update.type === "thinking_delta") {
          await sink.accept({
            type: "assistant.delta",
            message: currentAssistant,
            thinkingDelta: update.delta,
          });
        }
        return;
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        currentAssistant = _fromPiAssistant(
          event.message,
          _requireAssistant(currentAssistant).id
        );
        lastPiAssistant = event.message;
        if (_shouldCommitAssistant(event.message)) {
          await sink.accept({
            type: "assistant.completed",
            message: currentAssistant,
          });
        }
        return;
      }
      if (event.type === "tool_execution_start") {
        const assistant = _requireAssistant(currentAssistant);
        await sink.accept({
          type: "tool.started",
          messageId: assistant.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
        return;
      }
      if (event.type === "tool_execution_update") {
        if (options.signal.aborted) return;
        const output = _fromPiToolResult(event.partialResult, false);
        currentAssistant = _setToolOutput(
          _requireAssistant(currentAssistant),
          event.toolCallId,
          output
        );
        await sink.accept({
          type: "tool.updated",
          messageId: currentAssistant.id,
          toolCallId: event.toolCallId,
          message: currentAssistant,
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        if (options.signal.aborted) return;
        const output = _fromPiToolResult(event.result, event.isError);
        currentAssistant = _setToolOutput(
          _requireAssistant(currentAssistant),
          event.toolCallId,
          output
        );
        await sink.accept({
          type: "tool.completed",
          messageId: currentAssistant.id,
          toolCallId: event.toolCallId,
          message: currentAssistant,
        });
      }
    };

    await runAgentLoopContinue(
      context,
      {
        model,
        convertToLlm: _convertToLlm,
        toolExecution: "sequential",
        shouldStopAfterTurn({ toolResults }) {
          if (toolResults.length > 0 && turnIndex + 1 >= input.maxModelTurns) {
            turnLimitExceeded = true;
            return true;
          }
          return false;
        },
      },
      emit,
      options.signal,
      this._models.streamSimple.bind(this._models)
    );

    if (turnLimitExceeded) {
      throw new Error(
        `Run exceeded ${input.maxModelTurns} model turns without completing.`
      );
    }
    _assertSuccessfulCompletion(lastPiAssistant, options.signal);
  }

  /** Resolves a pinned provider/model definition without implicit fallback. */
  private _resolveModel(
    definition: RunExecutionInput["agent"]["snapshot"]["model"]
  ): Model<Api> {
    if (typeof definition !== "string") {
      throw new Error(
        "PiRunExecutor requires a static model string in provider/model format."
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

/**
 * Adapts one authored tool to Pi while preserving LLM Space validation,
 * ToolContext identity, cancellation, and async-iterable progress semantics.
 */
function _toPiTool(
  modelTool: ModelToolDefinition,
  input: RunExecutionInput,
  runSignal: AbortSignal,
  getStepIndex: () => number
): AgentTool {
  const prepared = input.agent.tools.get(modelTool.name);
  return {
    name: modelTool.name,
    label: modelTool.name,
    description: modelTool.description,
    parameters: modelTool.inputSchema,
    executionMode: "sequential",
    async execute(toolCallId, args, signal, onUpdate) {
      if (prepared === undefined) {
        throw new Error(`Unknown tool: ${modelTool.name}`);
      }
      const definition = prepared.definition;
      const validated = await validateSchemaValue(
        definition.inputSchema,
        args,
        { direction: "input", label: `Input for tool "${modelTool.name}"` }
      );
      const effectiveSignal = signal ?? runSignal;
      const context = input.createToolContext({
        execution: {
          threadId: input.threadId,
          runId: input.runId,
          stepIndex: getStepIndex(),
          callId: toolCallId,
          toolName: modelTool.name,
        },
        signal: effectiveSignal,
      });
      const execution = definition.execute(validated, context);
      let value: unknown;
      if (_isAsyncIterable(execution)) {
        let hasBufferedPart = false;
        for await (const part of execution) {
          if (hasBufferedPart) {
            onUpdate?.(await _toPiToolResult(definition, value));
          }
          value = part;
          hasBufferedPart = true;
        }
      } else {
        value = await execution;
      }
      if (definition.outputSchema !== undefined) {
        value = await validateSchemaValue(definition.outputSchema, value, {
          direction: "output",
          label: `Output from tool "${modelTool.name}"`,
        });
      }
      return _toPiToolResult(definition, value);
    },
  } as AgentTool;
}

/** Converts one authored tool value into Pi content plus durable Core details. */
async function _toPiToolResult(
  definition: ToolDefinition,
  value: unknown
): Promise<AgentToolResult<ToolCallOutput>> {
  const modelOutput =
    definition.toModelOutput === undefined
      ? _defaultModelOutput(value)
      : await definition.toModelOutput(value);
  const output = _toolCallOutput(modelOutput, false);
  return { content: output.content, details: output };
}

/** Safely narrows Pi tool results to the Core text/image output contract. */
function _fromPiToolResult(result: unknown, isError: boolean): ToolCallOutput {
  const record = _asRecord(result);
  const rawContent = Array.isArray(record?.content) ? record.content : [];
  const content: ToolCallOutput["content"] = [];
  for (const part of rawContent) {
    const item = _asRecord(part);
    if (item?.type === "text" && typeof item.text === "string") {
      content.push({ type: "text", text: item.text });
      continue;
    }
    if (
      item?.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string"
    ) {
      content.push({
        type: "image",
        data: item.data,
        mimeType: item.mimeType,
      });
    }
  }
  return { content, isError };
}

/** Filters Pi extension-only messages at the model request boundary. */
function _convertToLlm(messages: AgentMessage[]): PiMessage[] {
  return messages.filter(
    (message): message is PiMessage =>
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
  );
}

/** Expands embedded Core tool outputs into Pi's separate transcript records. */
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

/** Reconstructs a provider-compatible Pi assistant record for history replay. */
function _toPiAssistantMessage(
  message: AssistantMessage,
  model: Model<Api>
): PiAssistantMessage {
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

/**
 * Converts one Pi assistant snapshot to Core without persisting Pi-only
 * runtime identity; text annotations and provider replay metadata survive.
 */
function _fromPiAssistant(
  message: PiAssistantMessage,
  id: string
): AssistantMessage {
  const content = message.content
    .filter((part) => part.type === "text")
    .map((part) => ({
      type: "text" as const,
      text: part.text,
      ...(part.annotations === undefined
        ? {}
        : { annotations: part.annotations }),
    }));
  const thinking = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("");
  const toolCalls = message.content
    .filter((part) => part.type === "toolCall")
    .map((call) => ({
      id: call.id,
      input: { name: call.name, arguments: call.arguments },
    }));
  return {
    id,
    role: "assistant",
    content,
    ...(thinking.length === 0 ? {} : { thinking }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    usage: _toModelUsage(message.usage),
    ...(message.responseOutputItems === undefined
      ? {}
      : { responseOutputItems: message.responseOutputItems }),
    ...(message.nativeToolActivities === undefined
      ? {}
      : { providerHostedToolActivities: message.nativeToolActivities }),
  };
}

/** Returns a copy with one model-requested tool output embedded by call id. */
function _setToolOutput(
  message: AssistantMessage,
  toolCallId: string,
  output: ToolCallOutput
): AssistantMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((call) =>
      call.id === toolCallId ? { ...call, output } : call
    ),
  };
}

/**
 * Selects model responses safe to checkpoint. Truncated tool calls are kept
 * because Pi converts them into explicit non-executed error results.
 */
function _shouldCommitAssistant(message: PiAssistantMessage): boolean {
  if (
    message.stopReason === "error" ||
    message.stopReason === "aborted" ||
    message.stopReason === "deferred"
  ) {
    return false;
  }
  return !(
    message.stopReason === "length" &&
    !message.content.some((part) => part.type === "toolCall")
  );
}

/** Rejects terminal Pi states that must converge the durable Run as failed. */
function _assertSuccessfulCompletion(
  message: PiAssistantMessage | undefined,
  signal: AbortSignal
): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Run was cancelled.");
  }
  if (message === undefined) {
    throw new Error("Pi Agent loop ended without an assistant message.");
  }
  if (message.stopReason === "error") {
    throw new Error(message.errorMessage ?? "Pi Agent loop failed.");
  }
  if (message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "Pi Agent loop was aborted.");
  }
  if (message.stopReason === "deferred") {
    throw new Error("Deferred Pi responses are not supported by Engine.");
  }
  if (message.stopReason === "length") {
    throw new Error("Model turn stopped because its output limit was reached.");
  }
}

/** Normalizes authored model output and degrades unsupported files to text. */
function _toolCallOutput(
  output: ToolModelOutput,
  isError: boolean
): ToolCallOutput {
  if (output.type === "text") {
    return { content: [{ type: "text", text: output.value }], isError };
  }
  if (output.type === "json") {
    return {
      content: [{ type: "text", text: JSON.stringify(output.value) ?? "null" }],
      isError,
    };
  }
  return {
    content: output.value.map((part) =>
      part.type === "text"
        ? { type: "text" as const, text: part.text }
        : part.mediaType.startsWith("image/")
          ? {
              type: "image" as const,
              mimeType: part.mediaType,
              data: part.data.data,
            }
          : {
              type: "text" as const,
              text:
                part.filename === undefined
                  ? `[${part.mediaType} file]`
                  : `[${part.mediaType} file: ${part.filename}]`,
            }
    ),
    isError,
  };
}

/** Applies the authoring API's default string-or-JSON model projection. */
function _defaultModelOutput(value: unknown): ToolModelOutput {
  return typeof value === "string"
    ? { type: "text", value }
    : { type: "json", value };
}

/** Supplies Pi's required zero usage when legacy Core history omitted it. */
function _toPiUsage(usage: ModelUsage | undefined): Usage {
  return usage ?? _emptyUsage();
}

/** Copies provider usage into the durable Core representation. */
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

/** Creates the neutral usage required for replaying legacy Messages. */
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

/** Narrows the active model response or fails an invalid Pi event sequence. */
function _requireAssistant(
  message: AssistantMessage | undefined
): AssistantMessage {
  if (message === undefined) {
    throw new Error("Pi emitted an Agent event without an active assistant.");
  }
  return message;
}

/** Detects the authored streaming-tool return shape without consuming it. */
function _isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}

/** Narrows untrusted adapter payloads to non-array records. */
function _asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
