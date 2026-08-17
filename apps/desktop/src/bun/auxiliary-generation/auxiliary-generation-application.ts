import { PiAssistantExecutor } from "@llm-space/pi-runtime";
import { ModelManager } from "@llm-space/runtime/models";
import { coreMessagesToPi } from "@llm-space/studio";
import { inject, injectable } from "inversify";

import type {
  AuxiliaryGenerateEvent,
  AuxiliaryGenerateInput,
} from "../../shared/auxiliary-generation-rpc";

/** Executes UI helper generation without creating product or Pi Session state. */
@injectable()
export class AuxiliaryGenerationApplication {
  constructor(
    @inject(ModelManager)
    private readonly _models: Pick<
      ModelManager,
      "getAvailableModels" | "resolveConnection"
    >
  ) {}

  async *generate(
    input: AuxiliaryGenerateInput
  ): AsyncIterable<AuxiliaryGenerateEvent> {
    const signal = input.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    const executor = new PiAssistantExecutor({
      models: () => this._models.getAvailableModels(),
      resolveConnection: ({ providerId }) => {
        if (providerId !== input.model.provider) {
          throw new Error(
            `Auxiliary model provider "${providerId}" does not match the selected connection.`
          );
        }
        return this._models.resolveConnection({
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
