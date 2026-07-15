import {
  type Api,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Provider
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

import { type CustomProviderApi, DEFAULT_CUSTOM_PROVIDER_API } from "../types";

export function createCustomProvider({
  id,
  name,
  baseUrl,
  api = DEFAULT_CUSTOM_PROVIDER_API,
  models
}: {
  api?: CustomProviderApi;
  baseUrl: string;
  id: string;
  models: Array<Model<Api>>;
  name: string;
}): Provider {
  const implementation = {
    "anthropic-messages": anthropicMessagesApi,
    "openai-completions": openAICompletionsApi,
    "openai-responses": openAIResponsesApi
  }[api]();

  return createProvider({
    id,
    name,
    baseUrl,
    auth: { apiKey: envApiKeyAuth("NOT_A_KEY", []) },
    models,
    api: implementation
  });
}
