import type {
  ModelConfig,
  ModelProviderGroup,
  Thread,
} from "@llm-space/core";
import { resolveModelConfig } from "@llm-space/core/thread";

/**
 * Build the immutable copy published by sharing.
 *
 * The web viewer has no provider registry, so the Playground's resolved
 * model and display name must be frozen into the copy without mutating the
 * source Thread.
 */
export function buildSharedThread(
  thread: Thread,
  providers: ModelProviderGroup[],
  defaultModel: ModelConfig | null,
  title?: string
): Thread {
  const model = resolveModelConfig(providers, thread.model, defaultModel);
  const modelName = model
    ? providers
        .find((provider) => provider.id === model.provider)
        ?.models.find((candidate) => candidate.id === model.id)?.name ?? model.id
    : undefined;

  return {
    ...thread,
    ...(title !== undefined ? { title } : {}),
    ...(model ? { model, modelName } : {}),
  };
}
