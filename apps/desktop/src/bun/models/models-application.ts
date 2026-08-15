import type {
  CustomModel,
  ModelConfig,
} from "@llm-space/core";
import { streamAgent } from "@llm-space/core/server";
import {
  getModelProviderGroups,
  type ModelManager,
} from "@llm-space/runtime/models";

import type { ModelsRequests } from "../../shared/models-rpc";
import type { Analytics } from "../analytics";

/** Owns model configuration use cases and their product analytics. */
export class ModelsApplication implements ModelsRequests {
  constructor(
    private readonly _models: ModelManager,
    private readonly _analytics: Analytics
  ) {}

  list() {
    return getModelProviderGroups(this._models);
  }

  listBuiltin() {
    return this._models.getBuiltinProviders();
  }

  async removeProvider(providerId: string) {
    this._models.removeProvider(providerId);
    return this.list();
  }

  async addProvider(providerId: string) {
    this._models.addBuiltInProvider({ id: providerId });
    const groups = await this.list();
    this._analytics.capture("provider_added", { providerId, kind: "builtin" });
    return groups;
  }

  async addCustomProvider(
    input: Parameters<ModelsRequests["addCustomProvider"]>[0]
  ) {
    this._models.addCustomProvider(input);
    const groups = await this.list();
    this._analytics.capture("provider_added", {
      providerId: input.id,
      kind: "custom",
    });
    return groups;
  }

  async addProfile(providerId: string) {
    this._models.addProfile(providerId);
    return this.list();
  }

  async updateProfile(input: Parameters<ModelsRequests["updateProfile"]>[0]) {
    const { providerId, profileId, ...fields } = input;
    this._models.updateProfile(providerId, profileId, fields);
    return this.list();
  }

  async removeProfile(providerId: string, profileId: string) {
    this._models.removeProfile(providerId, profileId);
    return this.list();
  }

  async updateProvider(
    input: Parameters<ModelsRequests["updateProvider"]>[0]
  ) {
    const { providerId, ...fields } = input;
    this._models.updateProvider(providerId, fields);
    return this.list();
  }

  async setEnabled(providerId: string, modelId: string, enabled: boolean) {
    this._models.setModelEnabled(providerId, modelId, enabled);
    return this.list();
  }

  async setAllEnabled(providerId: string, enabled: boolean) {
    this._models.setAllModelsEnabled(providerId, enabled);
    return this.list();
  }

  getDefault() {
    return Promise.resolve(this._models.getDefaultModel());
  }

  setDefault(model: ModelConfig | null) {
    this._models.setDefaultModel(model);
    return this.getDefault();
  }

  async testConnection(
    input: Parameters<ModelsRequests["testConnection"]>[0]
  ) {
    const models = input.candidate
      ? this._models.buildModelsWithCandidate(input.providerId, input.candidate)
      : await this._models.getAvailableModels();
    const targetId = input.candidate?.id ?? input.modelId;
    const connection = await this._models.resolveConnection({
      providerId: input.providerId,
      profileId: input.profileId,
    });
    for await (const event of streamAgent(
      {
        model: { provider: input.providerId, id: targetId },
        context: {
          systemPrompt: "You are a connection tester.",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: 'Reply with "ok".' }],
              timestamp: Date.now(),
            },
          ],
          tools: [],
          responseApiNativeTools: [],
        },
      },
      {
        models,
        signal: new AbortController().signal,
        getApiKey: () => connection.apiKey,
        getBaseUrl: () => connection.baseUrl,
        getHeaders: () => connection.headers,
      }
    )) {
      if (event.type !== "agent_end") continue;
      for (const message of event.messages) {
        if (message.role === "assistant" && message.errorMessage) {
          throw new Error(message.errorMessage);
        }
      }
    }
  }

  async removeCustom(providerId: string, modelId: string) {
    this._models.removeCustomModel(providerId, modelId);
    return this.list();
  }

  async upsertCustom(
    providerId: string,
    model: CustomModel,
    originalId?: string
  ) {
    this._models.upsertCustomModel(providerId, model, originalId);
    return this.list();
  }

  async setImageEnabled(modelId: string, enabled: boolean) {
    this._models.setImageModelEnabled(modelId, enabled);
    return this.list();
  }

  async setAllImagesEnabled(enabled: boolean) {
    this._models.setAllImageModelsEnabled(enabled);
    return this.list();
  }

  async removeCustomImage(modelId: string) {
    this._models.removeCustomImageModel(modelId);
    return this.list();
  }

  async upsertCustomImage(
    model: Parameters<ModelsRequests["upsertCustomImage"]>[0],
    originalId?: string
  ) {
    this._models.upsertCustomImageModel(model, originalId);
    return this.list();
  }
}
