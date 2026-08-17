import type { ModelClient } from "@llm-space/ui/host";
import { inject, injectable } from "inversify";

import {
  MODELS_SERVICE,
  type ModelsRequests,
} from "@/shared/models-rpc";

/** Adapt the typed Models RPC namespace to the shared UI model contract. */
@injectable()
export class DesktopModelClient implements ModelClient {
  constructor(
    @inject(MODELS_SERVICE) private readonly _models: ModelsRequests
  ) {}

  availableModels = () => this._models.list();
  builtinProviders = () => this._models.listBuiltin();
  getDefaultModel = () => this._models.getDefault();
  setDefaultModel: ModelClient["setDefaultModel"] = (model) =>
    this._models.setDefault(model);
  removeProvider: ModelClient["removeProvider"] = (providerId) =>
    this._models.removeProvider(providerId);
  addProvider: ModelClient["addProvider"] = (providerId) =>
    this._models.addProvider(providerId);
  addCustomProvider: ModelClient["addCustomProvider"] = (input) =>
    this._models.addCustomProvider(input);
  addProviderProfile: ModelClient["addProviderProfile"] = (providerId) =>
    this._models.addProfile(providerId);
  updateProviderProfile: ModelClient["updateProviderProfile"] = (
    providerId,
    profileId,
    fields
  ) =>
    this._models.updateProfile({
        providerId,
        profileId,
        ...fields,
      });
  removeProviderProfile: ModelClient["removeProviderProfile"] = (
    providerId,
    profileId
  ) => this._models.removeProfile(providerId, profileId);
  updateProvider: ModelClient["updateProvider"] = (providerId, fields) =>
    this._models.updateProvider({ providerId, ...fields });
  setModelEnabled: ModelClient["setModelEnabled"] = (
    providerId,
    modelId,
    enabled
  ) => this._models.setEnabled(providerId, modelId, enabled);
  setAllModelsEnabled: ModelClient["setAllModelsEnabled"] = (
    providerId,
    enabled
  ) => this._models.setAllEnabled(providerId, enabled);
  testModelConnection: ModelClient["testModelConnection"] = async (
    providerId,
    modelId,
    candidate,
    profileId
  ) => {
      await this._models.testConnection({
        providerId,
        profileId,
        modelId,
        candidate,
      });
    };
  removeCustomModel: ModelClient["removeCustomModel"] = (
    providerId,
    modelId
  ) => this._models.removeCustom(providerId, modelId);
  upsertCustomModel: ModelClient["upsertCustomModel"] = (
    providerId,
    model,
    originalId
  ) => this._models.upsertCustom(providerId, model, originalId);
  setImageModelEnabled: ModelClient["setImageModelEnabled"] = (
    modelId,
    enabled
  ) => this._models.setImageEnabled(modelId, enabled);
  setAllImageModelsEnabled: ModelClient["setAllImageModelsEnabled"] = (
    enabled
  ) => this._models.setAllImagesEnabled(enabled);
  removeCustomImageModel: ModelClient["removeCustomImageModel"] = (modelId) =>
    this._models.removeCustomImage(modelId);
  upsertCustomImageModel: ModelClient["upsertCustomImageModel"] = (
    model,
    originalId
  ) => this._models.upsertCustomImage(model, originalId);
}
