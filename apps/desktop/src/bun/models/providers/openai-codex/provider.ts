import {
  type ApiKeyAuth,
  type AuthResult,
  createProvider,
  type Provider
} from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

import { getCodexCredentials } from "./config";

/**
 * Unified `openai-codex` provider that handles both auth modes:
 * - OAuth: delegates to pi-ai's `openaiCodexProvider()`.
 * - API key: builds a standard `openai-responses` provider with the endpoint
 *   from `~/.codex/config.toml`.
 */
export function createOpenAICodexProvider(): Provider {
  const credentials = getCodexCredentials();

  // API Key mode.
  if (credentials?.mode === "apikey") {
    const codex = openaiCodexProvider();
    const models = codex.getModels().map(model => ({
      ...model,
      api: credentials.api,
      baseUrl: credentials.baseUrl
    }));
    return createProvider({
      id: codex.id,
      name: codex.name,
      baseUrl: credentials.baseUrl,
      auth: { apiKey: _getCodexApiKeyAuth() },
      models,
      api: openAIResponsesApi()
    });
  }

  // OAuth mode.
  const codex = openaiCodexProvider();
  return {
    ...codex,
    auth: {
      ...codex.auth,
      apiKey: _getCodexApiKeyAuth()
    }
  };
}

function _getCodexApiKeyAuth(): ApiKeyAuth {
  return {
    name: "Codex CLI credentials",
    async resolve(): Promise<AuthResult | undefined> {
      const credentials = getCodexCredentials();
      if (!credentials) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ auth: { apiKey: credentials.apiKey } });
    }
  };
}
