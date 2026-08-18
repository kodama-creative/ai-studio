import type {
  CustomModel,
  ModelConfig,
} from "@llm-space/core";
import { streamAgent } from "@llm-space/core/server";
import {
  getModelProviderGroups,
  ModelManager,
} from "@llm-space/runtime/models";
import { inject, injectable } from "inversify";

import { Emitter } from "../../shared/event";
import type { ModelsRequests } from "../../shared/models-rpc";
import { Analytics } from "../analytics/analytics";

/** Owns model configuration use cases and their product analytics. */
@injectable()
export class ModelsService implements ModelsRequests {
  private readonly _didChange = new Emitter<void>();

  /** Fact emitted only after ModelManager persists a mutation. */
  readonly onDidChange = this._didChange.event;

  constructor(
    @inject(ModelManager) private readonly _models: ModelManager,
    @inject(Analytics) private readonly _analytics: Analytics
  ) {}

  list() {
    return getModelProviderGroups(this._models);
  }

  listBuiltin() {
    return this._models.getBuiltinProviders();
  }

  async removeProvider(providerId: string) {
    this._models.removeProvider(providerId);
    return this._changed();
  }

  async addProvider(providerId: string) {
    this._models.addBuiltInProvider({ id: providerId });
    const groups = await this._changed();
    this._analytics.capture("provider_added", { providerId, kind: "builtin" });
    return groups;
  }

  async addCustomProvider(
    input: Parameters<ModelsRequests["addCustomProvider"]>[0]
  ) {
    this._models.addCustomProvider(input);
    const groups = await this._changed();
    this._analytics.capture("provider_added", {
      providerId: input.id,
      kind: "custom",
    });
    return groups;
  }

  async addProfile(providerId: string) {
    this._models.addProfile(providerId);
    return this._changed();
  }

  async updateProfile(input: Parameters<ModelsRequests["updateProfile"]>[0]) {
    const { providerId, profileId, ...fields } = input;
    this._models.updateProfile(providerId, profileId, fields);
    return this._changed();
  }

  async removeProfile(providerId: string, profileId: string) {
    this._models.removeProfile(providerId, profileId);
    return this._changed();
  }

  async updateProvider(
    input: Parameters<ModelsRequests["updateProvider"]>[0]
  ) {
    const { providerId, ...fields } = input;
    this._models.updateProvider(providerId, fields);
    return this._changed();
  }

  async setEnabled(providerId: string, modelId: string, enabled: boolean) {
    this._models.setModelEnabled(providerId, modelId, enabled);
    return this._changed();
  }

  async setAllEnabled(providerId: string, enabled: boolean) {
    this._models.setAllModelsEnabled(providerId, enabled);
    return this._changed();
  }

  getDefault() {
    return Promise.resolve(this._models.getDefaultModel());
  }

  setDefault(model: ModelConfig | null) {
    this._models.setDefaultModel(model);
    this._didChange.fire();
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
    return this._changed();
  }

  async upsertCustom(
    providerId: string,
    model: CustomModel,
    originalId?: string
  ) {
    this._models.upsertCustomModel(providerId, model, originalId);
    return this._changed();
  }

  async setImageEnabled(modelId: string, enabled: boolean) {
    this._models.setImageModelEnabled(modelId, enabled);
    return this._changed();
  }

  async setAllImagesEnabled(enabled: boolean) {
    this._models.setAllImageModelsEnabled(enabled);
    return this._changed();
  }

  async removeCustomImage(modelId: string) {
    this._models.removeCustomImageModel(modelId);
    return this._changed();
  }

  async upsertCustomImage(
    model: Parameters<ModelsRequests["upsertCustomImage"]>[0],
    originalId?: string
  ) {
    this._models.upsertCustomImageModel(model, originalId);
    return this._changed();
  }

  private _changed() {
    this._didChange.fire();
    return this.list();
  }
}
