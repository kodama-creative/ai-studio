import type {
  ToolContext,
  ToolDefinition,
  ToolModelOutput,
} from "@llm-space/agent/tools";

import type {
  Conversation,
  ConversationAssistantMessage,
  ConversationMessage,
  ConversationToolCall,
} from "../conversation";
import type { PreparedTool } from "../generation/generation";
import type {
  RunExecutionInput,
  RunExecutor,
  RunOutputEvent,
} from "../run";

import type { ModelTurnEngine } from "./model-engine";
import { validateSchemaValue } from "./schema-validation";

const DEFAULT_MAX_MODEL_TURNS = 32;

export interface CreateModelRunExecutorOptions {
  readonly engine: ModelTurnEngine;
  readonly generateId?: (prefix: string) => string;
  readonly maxModelTurns?: number;
  readonly createToolContext: (input: {
    readonly execution: RunExecutionInput;
    readonly call: ConversationToolCall;
    readonly modelTurnIndex: number;
    readonly signal: AbortSignal;
  }) => ToolContext;
}

export function createModelRunExecutor(
  options: CreateModelRunExecutorOptions
): RunExecutor {
  const maxModelTurns = options.maxModelTurns ?? DEFAULT_MAX_MODEL_TURNS;
  if (!Number.isInteger(maxModelTurns) || maxModelTurns <= 0) {
    throw new Error("maxModelTurns must be a positive integer.");
  }
  return new ModelRunExecutor(
    options,
    maxModelTurns,
    options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`)
  );
}

class ModelRunExecutor implements RunExecutor {
  constructor(
    private readonly _options: CreateModelRunExecutorOptions,
    private readonly _maxModelTurns: number,
    private readonly _generateId: (prefix: string) => string
  ) {}

  async *execute(
    input: RunExecutionInput,
    options: { readonly signal: AbortSignal }
  ): AsyncIterable<RunOutputEvent> {
    let conversation = structuredClone(input.conversation);
    for (
      let modelTurnIndex = 0;
      modelTurnIndex < this._maxModelTurns;
      modelTurnIndex++
    ) {
      _throwIfAborted(options.signal);
      const messageId = this._generateId("message");
      let text = "";
      const toolCalls: ConversationToolCall[] = [];
      let finishReason:
        | "stop"
        | "tool-calls"
        | "length"
        | "other"
        | undefined;

      for await (const event of this._options.engine.run(
        {
          agentId: input.agent.snapshot.agentId,
          instructions: input.agent.snapshot.instructions,
          messages: _toModelMessages(conversation.messages),
          model: input.agent.snapshot.model,
          tools: input.agent.snapshot.tools,
        },
        { signal: options.signal }
      )) {
        _throwIfAborted(options.signal);
        if (finishReason !== undefined) {
          throw new Error("Model turn emitted data after its finish event.");
        }
        if (event.type === "text.delta") {
          text += event.delta;
          yield { type: "message.delta", messageId, delta: event.delta };
        } else if (event.type === "tool.call") {
          toolCalls.push({
            id: event.call.id,
            name: event.call.name,
            input: structuredClone(event.call.input),
          });
        } else {
          finishReason = event.reason;
        }
      }

      _assertFinish(finishReason, toolCalls);
      const message: ConversationAssistantMessage = {
        id: messageId,
        role: "assistant",
        content: text.length === 0 ? [] : [{ type: "text", text }],
        ...(toolCalls.length === 0 ? {} : { toolCalls }),
        model: input.agent.snapshot.model,
        origin: { runId: input.runId },
      };
      conversation = _appendMessage(conversation, message);
      yield { type: "message.completed", message };

      for (const call of toolCalls) {
        _throwIfAborted(options.signal);
        yield { type: "tool.started", messageId, toolCallId: call.id };
        const result = await this._executeTool(
          input,
          call,
          modelTurnIndex,
          options.signal
        );
        conversation = _setToolResult(conversation, messageId, call.id, result);
        yield {
          type: "tool.completed",
          messageId,
          toolCallId: call.id,
          result,
        };
      }
      if (toolCalls.length === 0) return;
    }
    throw new Error(
      `Run exceeded ${this._maxModelTurns} model turns without completing.`
    );
  }

  private async _executeTool(
    execution: RunExecutionInput,
    call: ConversationToolCall,
    modelTurnIndex: number,
    signal: AbortSignal
  ): Promise<NonNullable<ConversationToolCall["result"]>> {
    const prepared = execution.agent.tools.get(call.name);
    if (prepared === undefined) {
      return {
        output: { type: "text", value: `Unknown tool: ${call.name}` },
        isError: true,
      };
    }
    try {
      return {
        output: await _executeToolDefinition(
          prepared,
          call,
          this._options.createToolContext({
            execution,
            call,
            modelTurnIndex,
            signal,
          })
        ),
        isError: false,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        output: { type: "text", value: _errorMessage(error) },
        isError: true,
      };
    }
  }
}

function _toModelMessages(
  messages: readonly ConversationMessage[]
): import("../session/protocol").HarnessMessage[] {
  const result: import("../session/protocol").HarnessMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      result.push({
        id: message.id,
        role: "user",
        content: _textContent(message.content),
      });
      continue;
    }
    const assistant: import("../session/protocol").HarnessAssistantMessage = {
      id: message.id,
      role: "assistant",
      content: _textContent(message.content),
      toolCalls: (message.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    };
    result.push(assistant);
    for (const call of message.toolCalls ?? []) {
      if (call.result === undefined) continue;
      result.push({
        id: `${message.id}:${call.id}:result`,
        role: "tool",
        callId: call.id,
        name: call.name,
        output: call.result.output,
        isError: call.result.isError,
      });
    }
  }
  return result;
}

function _textContent(
  content: readonly import("../conversation").MessageContent[]
): string {
  return content
    .filter((item): item is import("../conversation").TextMessageContent =>
      item.type === "text"
    )
    .map((item) => item.text)
    .join("\n");
}

function _appendMessage(
  conversation: Conversation,
  message: ConversationAssistantMessage
): Conversation {
  return { ...conversation, messages: [...conversation.messages, message] };
}

function _setToolResult(
  conversation: Conversation,
  messageId: string,
  toolCallId: string,
  result: NonNullable<ConversationToolCall["result"]>
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.id !== messageId || message.role !== "assistant"
        ? message
        : {
            ...message,
            toolCalls: message.toolCalls?.map((call) =>
              call.id === toolCallId ? { ...call, result } : call
            ),
          }
    ),
  };
}

async function _executeToolDefinition(
  prepared: PreparedTool,
  call: ConversationToolCall,
  context: ToolContext
): Promise<ToolModelOutput> {
  const input = await validateSchemaValue(
    prepared.definition.inputSchema,
    call.input,
    { direction: "input", label: `Input for tool "${call.name}"` }
  );
  const execution = prepared.definition.execute(input, context);
  const values: unknown[] = [];
  if (_isAsyncIterable(execution)) {
    for await (const value of execution) {
      values.push(await _validateToolOutput(prepared.definition, call, value));
    }
  } else {
    values.push(
      await _validateToolOutput(prepared.definition, call, await execution)
    );
  }
  const value = values.length === 1 ? values[0] : values;
  if (prepared.definition.toModelOutput !== undefined) {
    return await prepared.definition.toModelOutput(value);
  }
  if (typeof value === "string") return { type: "text", value };
  return { type: "json", value: value ?? null };
}

async function _validateToolOutput(
  definition: ToolDefinition,
  call: ConversationToolCall,
  value: unknown
): Promise<unknown> {
  return definition.outputSchema === undefined
    ? value
    : await validateSchemaValue(definition.outputSchema, value, {
        direction: "output",
        label: `Output from tool "${call.name}"`,
      });
}

function _isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

function _assertFinish(
  finishReason: "stop" | "tool-calls" | "length" | "other" | undefined,
  toolCalls: readonly ConversationToolCall[]
): void {
  if (finishReason === undefined) {
    throw new Error("Model turn ended without a finish event.");
  }
  if (finishReason === "length") {
    throw new Error("Model turn stopped because its output limit was reached.");
  }
  if (finishReason === "other") {
    throw new Error("Model turn ended with an unsupported finish reason.");
  }
  if (toolCalls.length > 0 && finishReason !== "tool-calls") {
    throw new Error(
      `Model turn emitted tool calls with finish reason "${finishReason}".`
    );
  }
  if (toolCalls.length === 0 && finishReason !== "stop") {
    throw new Error(
      `Model turn finished as "${finishReason}" without any tool calls.`
    );
  }
}

function _throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Run was cancelled.");
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
