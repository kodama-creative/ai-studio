import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";

import type { StreamFn } from "@earendil-works/pi-agent-core";

import { DurableOperationOutcomeUnknownError } from "../harness/durable-operation-outcome-unknown-error";

import type { DurableOperationCoordinator } from "./durable-operation-coordinator";
import type { RuntimeJsonValue } from "../harness/runtime-run";

export function createDurableProviderStream(input: {
  readonly coordinator: DurableOperationCoordinator;
  readonly onTerminalError: (error: Error) => void;
  readonly stream: StreamFn;
  readonly transcriptMessageCount: () => number;
}): StreamFn {
  return async (model, context, options) => {
    if (!input.coordinator.enabled) {
      return input.stream(model, context, options);
    }
    let begun;
    try {
      begun = await input.coordinator.beginProvider({
        provider: model.provider,
        request: _providerRequest(model, context, options),
        transcriptMessageCount: input.transcriptMessageCount()
      });
      if (!begun) {
        return input.stream(model, context, options);
      }
      if (begun.type === "replay") {
        if (
          begun.operation.state !== "completed"
          && begun.operation.state !== "failed"
        ) {
          throw new Error("Durable provider replay has no terminal result");
        }
        return _replayedProviderStream(
          begun.operation.state,
          begun.value,
          model
        );
      }
      if (options?.signal?.aborted) {
        await input.coordinator.markCancelled(begun.operation);
        return _terminalStream(_abortedMessage(model));
      }
    } catch (error) {
      const terminal = _asError(error);
      input.onTerminalError(terminal);
      return _terminalStream(_errorMessage(model, terminal));
    }

    const outer = createAssistantMessageEventStream();
    void (async () => {
      try {
        const source = await input.stream(model, context, options);
        for await (const event of source) {
          if (event.type !== "done" && event.type !== "error") {
            outer.push(event);
            continue;
          }
          const message = await source.result();
          if (message.stopReason === "aborted") {
            await input.coordinator.markOutcomeUnknown(begun.operation);
            const error = new DurableOperationOutcomeUnknownError(
              begun.operation.id,
              `Provider operation ${begun.operation.id} was aborted after possible dispatch`
            );
            input.onTerminalError(error);
            outer.push({ type: "error", reason: "error", error: message });
            return;
          }
          await input.coordinator.settleProvider({
            operation: begun.operation,
            state: message.stopReason === "error" ? "failed" : "completed",
            value: { type: "providerMessage", message }
          });
          outer.push(event);
          return;
        }
        const message = await source.result();
        await input.coordinator.settleProvider({
          operation: begun.operation,
          state: message.stopReason === "error" ? "failed" : "completed",
          value: { type: "providerMessage", message }
        });
        outer.push(
          message.stopReason === "error" || message.stopReason === "aborted"
            ? {
              type: "error",
              reason: message.stopReason,
              error: message
            }
            : { type: "done", reason: message.stopReason, message }
        );
      } catch (error) {
        try {
          await input.coordinator.markOutcomeUnknown(begun.operation);
        } catch {
          // The original durable error remains authoritative.
        }
        const terminal = error instanceof DurableOperationOutcomeUnknownError
          ? error
          : new DurableOperationOutcomeUnknownError(
            begun.operation.id,
            error instanceof Error ? error.message : String(error)
          );
        input.onTerminalError(terminal);
        const message = _errorMessage(model, terminal);
        outer.push({ type: "error", reason: "error", error: message });
      }
    })();
    return outer;
  };
}

function _replayedProviderStream(
  state: "completed" | "failed",
  value: RuntimeJsonValue,
  model: Model<Api>
): AssistantMessageEventStream {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return _terminalStream(_errorMessage(
      model,
      new Error("Durable provider replay material is invalid")
    ));
  }
  const record = value as Record<string, RuntimeJsonValue>;
  const message = record.type === "providerMessage"
    ? record.message as unknown as AssistantMessage
    : null;
  if (message?.role !== "assistant") {
    return _terminalStream(_errorMessage(
      model,
      new Error("Durable provider replay message is invalid")
    ));
  }
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push(
      state === "failed"
      || message.stopReason === "error"
      || message.stopReason === "aborted"
        ? {
          type: "error",
          reason: message.stopReason === "aborted" ? "aborted" : "error",
          error: message
        }
        : { type: "done", reason: message.stopReason, message }
    );
  });
  return stream;
}

function _terminalStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push(message.stopReason === "aborted"
      ? { type: "error", reason: "aborted", error: message }
      : { type: "error", reason: "error", error: message });
  });
  return stream;
}

function _providerRequest(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): unknown {
  return {
    model: {
      api: model.api,
      provider: model.provider,
      id: model.id,
      baseUrl: model.baseUrl
    },
    context,
    options: {
      cacheRetention: options?.cacheRetention,
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      maxTokens: options?.maxTokens,
      reasoning: options?.reasoning,
      temperature: options?.temperature,
      thinkingBudgets: options?.thinkingBudgets,
      timeoutMs: options?.timeoutMs,
      transport: options?.transport,
      websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs
    }
  };
}

function _errorMessage(model: Model<Api>, error: Error): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
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
    },
    stopReason: "error",
    errorMessage: error.message,
    timestamp: Date.now()
  };
}

function _abortedMessage(model: Model<Api>): AssistantMessage {
  return {
    ..._errorMessage(model, new Error("Request was aborted before dispatch")),
    stopReason: "aborted"
  };
}

function _asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
