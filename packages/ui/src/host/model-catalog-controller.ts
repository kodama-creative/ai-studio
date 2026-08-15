import type {
  CustomModel,
  ModelConfig,
  ModelProviderGroup,
  ProviderProfilePatch,
} from "@llm-space/core";
import { uuid } from "@llm-space/core";

import type { ModelClient } from "./types";

const EMPTY_MODEL_PROVIDERS: ModelProviderGroup[] = [];

export interface ModelCatalogSnapshot {
  readonly client: ModelClient;
  readonly defaultModel: ModelConfig | null;
  readonly epoch: number;
  readonly providers: ModelProviderGroup[] | null;
}

interface ModelRequestLease {
  readonly client: ModelClient;
  readonly epoch: number;
  readonly generation: number;
}

type Listener = () => void;

/**
 * Owns model-catalog loading, runtime epochs, and ordered host mutations.
 *
 * The interface exposes current user intents. Client switching, stale response
 * suppression, and per-client mutation queues remain inside the module.
 */
export class ModelCatalogController {
  private readonly _listeners = new Set<Listener>();
  private readonly _mutationTails = new WeakMap<ModelClient, Promise<void>>();
  private _latestRequestGeneration = 0;
  private _nextEpoch = 1;
  private _scope: { client: ModelClient; epoch: number };
  private _snapshot: ModelCatalogSnapshot;
  private _started = false;

  constructor(private _client: ModelClient) {
    this._scope = { client: _client, epoch: 1 };
    this._snapshot = {
      client: _client,
      defaultModel: null,
      epoch: 1,
      providers: null,
    };
  }

  readonly getSnapshot = (): ModelCatalogSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    if (this._started) return;
    this._started = true;
    void this.refresh();
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._latestRequestGeneration += 1;
  }

  setClient(client: ModelClient): void {
    if (this._scope.client === client) return;
    const scope = { client, epoch: ++this._nextEpoch };
    this._client = client;
    this._scope = scope;
    this._latestRequestGeneration += 1;
    this._set({
      client,
      defaultModel: null,
      epoch: scope.epoch,
      providers: EMPTY_MODEL_PROVIDERS,
    });
    if (this._started) void this.refresh();
  }

  readonly setDefaultModel = async (
    model: ModelConfig | null
  ): Promise<void> => {
    const client = this._client;
    const result = await this._enqueueMutation(client, () =>
      client.setDefaultModel(model)
    );
    if (!result || !this._isCurrentScope(result.lease)) return;
    this._set({
      client,
      defaultModel: result.value,
      epoch: result.lease.epoch,
      providers:
        this._snapshot.client === client &&
        this._snapshot.epoch === result.lease.epoch
          ? this._snapshot.providers
          : EMPTY_MODEL_PROVIDERS,
    });
  };

  readonly removeProvider = async (providerId: string): Promise<void> => {
    await this._mutateProviders((client) => client.removeProvider(providerId));
  };

  readonly addProvider = async (providerId: string): Promise<void> => {
    await this._mutateProviders((client) => client.addProvider(providerId));
  };

  readonly addCustomProvider = async (
    name: string,
    baseUrl: string
  ): Promise<string> => {
    const id = uuid();
    await this._mutateProviders((client) =>
      client.addCustomProvider({ id, name, baseUrl })
    );
    return id;
  };

  readonly addProviderProfile = async (providerId: string): Promise<string> => {
    const client = this._client;
    const result = await this._enqueueMutation(client, () =>
      client.addProviderProfile(providerId)
    );
    if (!result) {
      throw new Error("Model provider scope changed while adding a profile.");
    }
    this._commitProviders(result.lease, result.value);
    const profile = result.value
      .find((provider) => provider.id === providerId)
      ?.profiles.at(-1);
    if (!profile) {
      throw new Error(`Failed to add profile for provider: ${providerId}`);
    }
    return profile.id;
  };

  readonly updateProviderProfile = async (
    providerId: string,
    profileId: string,
    fields: ProviderProfilePatch
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.updateProviderProfile(providerId, profileId, fields)
    );
  };

  readonly removeProviderProfile = async (
    providerId: string,
    profileId: string
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.removeProviderProfile(providerId, profileId)
    );
  };

  readonly updateProvider = async (
    providerId: string,
    fields: Parameters<ModelClient["updateProvider"]>[1]
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.updateProvider(providerId, fields)
    );
  };

  readonly setModelEnabled = async (
    providerId: string,
    modelId: string,
    enabled: boolean
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.setModelEnabled(providerId, modelId, enabled)
    );
  };

  readonly setAllModelsEnabled = async (
    providerId: string,
    enabled: boolean
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.setAllModelsEnabled(providerId, enabled)
    );
  };

  readonly testModelConnection = async (
    providerId: string,
    modelId: string,
    candidate?: CustomModel,
    profileId?: string
  ): Promise<void> => {
    await this._client.testModelConnection(
      providerId,
      modelId,
      candidate,
      profileId
    );
  };

  readonly removeCustomModel = async (
    providerId: string,
    modelId: string
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.removeCustomModel(providerId, modelId)
    );
  };

  readonly upsertCustomModel = async (
    providerId: string,
    model: CustomModel,
    originalId?: string
  ): Promise<void> => {
    await this._mutateProviders((client) =>
      client.upsertCustomModel(providerId, model, originalId)
    );
  };

  readonly builtinProviders = (): Promise<ModelProviderGroup[]> =>
    this._client.builtinProviders();

  readonly refresh = async (): Promise<void> => {
    const client = this._client;
    const lease = this._beginRequest(client);
    if (!lease) return;
    try {
      const pendingMutation = this._mutationTails.get(client);
      if (pendingMutation) await pendingMutation;
      if (!this._isCurrentRequest(lease)) return;
      const [providers, defaultModel] = await Promise.all([
        client.availableModels(),
        client.getDefaultModel(),
      ]);
      if (!this._isCurrentRequest(lease)) return;
      this._set({
        client,
        defaultModel: defaultModel ?? null,
        epoch: lease.epoch,
        providers,
      });
    } catch (error) {
      if (this._isCurrentRequest(lease)) {
        console.error("Failed to fetch models", error);
      }
    }
  };

  private async _mutateProviders(
    mutate: (client: ModelClient) => Promise<ModelProviderGroup[]>
  ): Promise<void> {
    const client = this._client;
    const result = await this._enqueueMutation(client, () => mutate(client));
    if (result) this._commitProviders(result.lease, result.value);
  }

  private async _enqueueMutation<T>(
    client: ModelClient,
    mutate: () => Promise<T>
  ): Promise<{ lease: ModelRequestLease; value: T } | null> {
    const lease = this._beginRequest(client);
    if (!lease) return null;
    const previous = this._mutationTails.get(client) ?? Promise.resolve();
    const result = previous.then(async () => ({
      lease,
      value: await mutate(),
    }));
    this._mutationTails.set(
      client,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }

  private _commitProviders(
    lease: ModelRequestLease,
    providers: ModelProviderGroup[]
  ): void {
    if (!this._isCurrentScope(lease)) return;
    this._set({
      client: lease.client,
      defaultModel:
        this._snapshot.client === lease.client &&
        this._snapshot.epoch === lease.epoch
          ? this._snapshot.defaultModel
          : null,
      epoch: lease.epoch,
      providers,
    });
  }

  private _beginRequest(client: ModelClient): ModelRequestLease | null {
    if (!this._started || this._scope.client !== client) return null;
    return {
      ...this._scope,
      generation: ++this._latestRequestGeneration,
    };
  }

  private _isCurrentScope(lease: ModelRequestLease): boolean {
    return (
      this._started &&
      this._scope.client === lease.client &&
      this._scope.epoch === lease.epoch
    );
  }

  private _isCurrentRequest(lease: ModelRequestLease): boolean {
    return (
      this._isCurrentScope(lease) &&
      this._latestRequestGeneration === lease.generation
    );
  }

  private _set(snapshot: ModelCatalogSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
