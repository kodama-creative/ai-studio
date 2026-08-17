import type {
  CustomModel,
  ModelConfig,
  ModelProviderGroup,
  ProviderProfilePatch,
  SeedreamImageModelDefinition,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";

export const MODELS_SERVICE = Symbol("ModelsService");

export interface ModelsRequests {
  list(): Promise<ModelProviderGroup[]>;
  listBuiltin(): Promise<ModelProviderGroup[]>;
  removeProvider(providerId: string): Promise<ModelProviderGroup[]>;
  addProvider(providerId: string): Promise<ModelProviderGroup[]>;
  addCustomProvider(input: {
    id: string;
    name: string;
    baseUrl: string;
    api?: "anthropic-messages" | "openai-completions" | "openai-responses";
  }): Promise<ModelProviderGroup[]>;
  addProfile(providerId: string): Promise<ModelProviderGroup[]>;
  updateProfile(
    input: { providerId: string; profileId: string } & ProviderProfilePatch
  ): Promise<ModelProviderGroup[]>;
  removeProfile(
    providerId: string,
    profileId: string
  ): Promise<ModelProviderGroup[]>;
  updateProvider(input: {
    providerId: string;
    name?: string | null;
    api?:
      | "anthropic-messages"
      | "openai-completions"
      | "openai-responses"
      | null;
    icon?: string | null;
  }): Promise<ModelProviderGroup[]>;
  setEnabled(
    providerId: string,
    modelId: string,
    enabled: boolean
  ): Promise<ModelProviderGroup[]>;
  setAllEnabled(
    providerId: string,
    enabled: boolean
  ): Promise<ModelProviderGroup[]>;
  getDefault(): Promise<ModelConfig | null>;
  setDefault(model: ModelConfig | null): Promise<ModelConfig | null>;
  testConnection(input: {
    providerId: string;
    profileId?: string;
    modelId: string;
    candidate?: CustomModel;
  }): Promise<void>;
  removeCustom(
    providerId: string,
    modelId: string
  ): Promise<ModelProviderGroup[]>;
  upsertCustom(
    providerId: string,
    model: CustomModel,
    originalId?: string
  ): Promise<ModelProviderGroup[]>;
  setImageEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelProviderGroup[]>;
  setAllImagesEnabled(enabled: boolean): Promise<ModelProviderGroup[]>;
  removeCustomImage(modelId: string): Promise<ModelProviderGroup[]>;
  upsertCustomImage(
    model: SeedreamImageModelDefinition,
    originalId?: string
  ): Promise<ModelProviderGroup[]>;
}

export interface ModelsEvents {
  changed: Record<never, never>;
}

export interface ModelsRpc {
  readonly requests: ModelsRequests;
  readonly streams: Record<never, never>;
  readonly events: ModelsEvents;
}

export const MODELS_RPC = defineRpcNamespace<ModelsRpc>("models", {
  requests: {
    list: true,
    listBuiltin: true,
    removeProvider: true,
    addProvider: true,
    addCustomProvider: true,
    addProfile: true,
    updateProfile: true,
    removeProfile: true,
    updateProvider: true,
    setEnabled: true,
    setAllEnabled: true,
    getDefault: true,
    setDefault: true,
    testConnection: true,
    removeCustom: true,
    upsertCustom: true,
    setImageEnabled: true,
    setAllImagesEnabled: true,
    removeCustomImage: true,
    upsertCustomImage: true,
  },
  streams: {},
  events: { changed: true },
});
