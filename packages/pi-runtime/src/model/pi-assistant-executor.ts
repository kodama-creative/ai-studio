import { convertToLlm } from "@earendil-works/pi-agent-core";
import type {
  Api,
  Model,
  Models,
  SimpleStreamOptions,
  Tool,
  ThinkingLevel,
} from "@earendil-works/pi-ai";

import type { RuntimeBinding } from "../bindings/bun-sqlite-runtime-binding-store";
import type {
  AssistantAvailability,
  AssistantExecutor,
} from "../runtime/studio-pi-session-runtime";

export interface PiAssistantExecutorOptions {
  readonly models: Models | (() => Models | Promise<Models>);
  /** Resolves frozen tool identities into model-visible schemas, without fallback. */
  readonly resolveTools?: (
    binding: RuntimeBinding
  ) => readonly Tool[] | Promise<readonly Tool[]>;
  readonly streamOptions?: SimpleStreamOptions;
  /** Resolves request-local credentials without persisting them in bindings. */
  readonly resolveConnection?: (
    input: PiProviderConnectionInput
  ) => PiProviderConnection | Promise<PiProviderConnection>;
}

export interface PiProviderConnectionInput {
  readonly operationId: string;
  readonly providerId: string;
  readonly signal: AbortSignal;
}

export interface PiProviderConnection {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly headers?: Record<string, string>;
}

/** Executes one Pi provider stream directly, without `Agent` or `agentLoopContinue`. */
export class PiAssistantExecutor implements AssistantExecutor {
  constructor(private readonly _options: PiAssistantExecutorOptions) {}

  /** Reports a missing frozen model without creating a billable provider effect. */
  async checkAvailability(
    binding: RuntimeBinding
  ): Promise<AssistantAvailability> {
    const model = (await this._models()).getModel(
      binding.model.provider,
      binding.model.modelId
    );
    return model === undefined
      ? {
          available: false,
          message: `Pi model "${binding.model.provider}/${binding.model.modelId}" was not found.`,
        }
      : { available: true };
  }

  /** Returns one complete assistant message and forwards only ephemeral deltas. */
  async execute(input: Parameters<AssistantExecutor["execute"]>[0]) {
    const models = await this._models();
    const model = this._resolveModel(models, input.binding);
    const tools = await this._options.resolveTools?.(input.binding);
    const connection = await this._options.resolveConnection?.({
      operationId: input.operationId,
      providerId: model.provider,
      signal: input.signal,
    });
    const requestModel =
      connection?.baseUrl === undefined
        ? model
        : { ...model, baseUrl: connection.baseUrl };
    const stream = models.streamSimple(
      requestModel,
      {
        systemPrompt: input.binding.systemPrompt,
        messages: convertToLlm([...input.messages]),
        ...(tools === undefined ? {} : { tools: [...tools] }),
      },
      {
        ...this._options.streamOptions,
        signal: input.signal,
        ...(connection?.apiKey === undefined
          ? {}
          : { apiKey: connection.apiKey }),
        ...(connection?.headers === undefined
          ? {}
          : {
              headers: {
                ...connection.headers,
                ...this._options.streamOptions?.headers,
              },
            }),
        ...(_reasoning(input.binding.model.thinkingLevel) === undefined
          ? {}
          : { reasoning: _reasoning(input.binding.model.thinkingLevel) }),
      }
    );
    for await (const event of stream) {
      if (event.type === "text_delta") {
        await input.onDelta?.({
          type: "assistant.text_delta",
          delta: event.delta,
        });
      } else if (event.type === "thinking_delta") {
        await input.onDelta?.({
          type: "assistant.thinking_delta",
          delta: event.delta,
        });
      }
    }
    return stream.result();
  }

  /** Resolves the frozen provider/model pair and never substitutes a default. */
  private _resolveModel(models: Models, binding: RuntimeBinding): Model<Api> {
    const model = models.getModel(
      binding.model.provider,
      binding.model.modelId
    );
    if (model === undefined) {
      throw new Error(
        `Pi model "${binding.model.provider}/${binding.model.modelId}" was not found.`
      );
    }
    return model;
  }

  /** Reads the current host registry while keeping credentials out of binding data. */
  private _models(): Models | Promise<Models> {
    return typeof this._options.models === "function"
      ? this._options.models()
      : this._options.models;
  }
}

/** Narrows persisted thinking values to levels supported by Pi streaming. */
function _reasoning(value: string | undefined): ThinkingLevel | undefined {
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : undefined;
}
