import type { ModelClient } from "@llm-space/ui/host";

import type { ModelsRequests } from "@/shared/models-rpc";

/** Adapt the typed Models RPC namespace to the shared UI model contract. */
export function createElectrobunModelClient(
  modelsClient: ModelsRequests
): ModelClient {
  return {
    availableModels: () => modelsClient.list(),
    builtinProviders: () => modelsClient.listBuiltin(),
    getDefaultModel: () => modelsClient.getDefault(),
    setDefaultModel: (model) => modelsClient.setDefault(model),
    removeProvider: (providerId) => modelsClient.removeProvider(providerId),
    addProvider: (providerId) => modelsClient.addProvider(providerId),
    addCustomProvider: (input) => modelsClient.addCustomProvider(input),
    addProviderProfile: (providerId) => modelsClient.addProfile(providerId),
    updateProviderProfile: (providerId, profileId, fields) =>
      modelsClient.updateProfile({
        providerId,
        profileId,
        ...fields,
      }),
    removeProviderProfile: (providerId, profileId) =>
      modelsClient.removeProfile(providerId, profileId),
    updateProvider: (providerId, fields) =>
      modelsClient.updateProvider({ providerId, ...fields }),
    setModelEnabled: (providerId, modelId, enabled) =>
      modelsClient.setEnabled(providerId, modelId, enabled),
    setAllModelsEnabled: (providerId, enabled) =>
      modelsClient.setAllEnabled(providerId, enabled),
    testModelConnection: async (providerId, modelId, candidate, profileId) => {
      await modelsClient.testConnection({
        providerId,
        profileId,
        modelId,
        candidate,
      });
    },
    removeCustomModel: (providerId, modelId) =>
      modelsClient.removeCustom(providerId, modelId),
    upsertCustomModel: (providerId, model, originalId) =>
      modelsClient.upsertCustom(providerId, model, originalId),
    setImageModelEnabled: (modelId, enabled) =>
      modelsClient.setImageEnabled(modelId, enabled),
    setAllImageModelsEnabled: (enabled) =>
      modelsClient.setAllImagesEnabled(enabled),
    removeCustomImageModel: (modelId) =>
      modelsClient.removeCustomImage(modelId),
    upsertCustomImageModel: (model, originalId) =>
      modelsClient.upsertCustomImage(model, originalId),
  };
}
