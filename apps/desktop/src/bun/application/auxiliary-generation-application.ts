import type { Models } from "@earendil-works/pi-ai";
import { PiAssistantExecutor } from "@llm-space/pi-runtime";
import { coreMessagesToPi } from "@llm-space/studio";

import type {
  AuxiliaryGenerateEvent,
  AuxiliaryGenerateInput,
} from "../../shared/auxiliary-generation-rpc";

interface AuxiliaryGenerationApplicationOptions {
  readonly models: Models | (() => Models | Promise<Models>);
  readonly resolveConnection?: (input: {
    readonly providerId: string;
    readonly profileId?: string;
  }) =>
    | {
        readonly apiKey?: string;
        readonly baseUrl?: string;
        readonly headers?: Record<string, string>;
      }
    | Promise<{
        readonly apiKey?: string;
        readonly baseUrl?: string;
        readonly headers?: Record<string, string>;
      }>;
}

/** Executes UI helper generation without creating product or Pi Session state. */
export class AuxiliaryGenerationApplication {
  constructor(private readonly _options: AuxiliaryGenerationApplicationOptions) {}

  async *generate(
    input: AuxiliaryGenerateInput
  ): AsyncIterable<AuxiliaryGenerateEvent> {
    const signal = input.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    const executor = new PiAssistantExecutor({
      models: this._options.models,
      resolveConnection:
        this._options.resolveConnection === undefined
          ? undefined
          : ({ providerId }) => {
              if (providerId !== input.model.provider) {
                throw new Error(
                  `Auxiliary model provider "${providerId}" does not match the selected connection.`
                );
              }
              return this._options.resolveConnection!({
                providerId,
                ...(input.profileId === undefined
                  ? {}
                  : { profileId: input.profileId }),
              });
            },
      streamOptions: {
        ...(input.model.params?.temperature === undefined
          ? {}
          : { temperature: input.model.params.temperature }),
        ...(input.model.params?.maxTokens === undefined
          ? {}
          : { maxTokens: input.model.params.maxTokens }),
      },
    });
    const binding = {
      formatVersion: 1,
      agent: { agentSpecId: "auxiliary", sourceRevision: "stateless" },
      model: {
        provider: input.model.provider,
        modelId: input.model.id,
        ...(input.model.params?.reasoning === undefined
          ? {}
          : { thinkingLevel: input.model.params.reasoning }),
      },
      systemPrompt: input.systemPrompt,
      tools: [],
    };
    const assistant = await executor.execute({
      operationId: `auxiliary:${crypto.randomUUID()}`,
      binding,
      messages: coreMessagesToPi(input.messages, binding.model),
      signal,
    });
    signal.throwIfAborted();
    const text = assistant.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    yield { type: "text.completed", text };
  }
}
