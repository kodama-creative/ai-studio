import type { Message, ModelConfig } from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";

export const AUXILIARY_GENERATION_SERVICE = Symbol(
  "AuxiliaryGenerationService"
);

export interface AuxiliaryGenerateInput {
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
  readonly model: ModelConfig;
  readonly profileId?: string;
  readonly signal?: AbortSignal;
}

export type AuxiliaryGenerateEvent =
  | { readonly type: "text.delta"; readonly delta: string }
  | { readonly type: "text.completed"; readonly text: string };

export interface AuxiliaryGenerationRpc {
  readonly requests: Record<never, never>;
  readonly streams: {
    generate(input: AuxiliaryGenerateInput): AsyncIterable<AuxiliaryGenerateEvent>;
  };
  readonly events: Record<never, never>;
}

export const AUXILIARY_GENERATION_RPC =
  defineRpcNamespace<AuxiliaryGenerationRpc>("auxiliaryGeneration", {
    requests: {},
    streams: { generate: true },
    events: {},
  });
