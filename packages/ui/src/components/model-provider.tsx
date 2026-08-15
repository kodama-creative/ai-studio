"use client";

import type * as pi from "@earendil-works/pi-ai";
import type {
  CustomModel,
  ModelConfig,
  ModelProviderGroup,
  ProviderProfilePatch,
  SeedreamImageModelDefinition,
} from "@llm-space/core";
import { resolveModelConfig } from "@llm-space/core/thread";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ModelClient } from "../host";
import { ModelCatalogController } from "../host/model-catalog-controller";

interface ModelContextValue {
  providers: ModelProviderGroup[];
  removeProvider: (providerId: string) => Promise<void>;
  addProvider: (providerId: string) => Promise<void>;
  addCustomProvider: (name: string, baseUrl: string) => Promise<string>;
  addProviderProfile: (providerId: string) => Promise<string>;
  updateProviderProfile: (
    providerId: string,
    profileId: string,
    fields: ProviderProfilePatch
  ) => Promise<void>;
  removeProviderProfile: (
    providerId: string,
    profileId: string
  ) => Promise<void>;
  updateProvider: (
    providerId: string,
    fields: {
      name?: string | null;
      api?:
        "anthropic-messages" | "openai-completions" | "openai-responses" | null;
      icon?: string | null;
    }
  ) => Promise<void>;
  setModelEnabled: (
    providerId: string,
    modelId: string,
    enabled: boolean
  ) => Promise<void>;
  setAllModelsEnabled: (providerId: string, enabled: boolean) => Promise<void>;
  testModelConnection: (
    providerId: string,
    modelId: string,
    candidate?: CustomModel,
    profileId?: string
  ) => Promise<void>;
  removeCustomModel: (providerId: string, modelId: string) => Promise<void>;
  upsertCustomModel: (
    providerId: string,
    model: CustomModel,
    originalId?: string
  ) => Promise<void>;
  setImageModelEnabled: (modelId: string, enabled: boolean) => Promise<void>;
  setAllImageModelsEnabled: (enabled: boolean) => Promise<void>;
  removeCustomImageModel: (modelId: string) => Promise<void>;
  upsertCustomImageModel: (
    model: SeedreamImageModelDefinition,
    originalId?: string
  ) => Promise<void>;
  refresh: () => Promise<void>;
  builtinProviders: () => Promise<ModelProviderGroup[]>;
  getModel: (ref: { id: string; provider: string }) => pi.Model<pi.Api> | null;
  defaultModel: ModelConfig | null;
  setDefaultModel: (model: ModelConfig | null) => Promise<void>;
}

const ModelContext = createContext<ModelContextValue | null>(null);
const EMPTY_MODEL_PROVIDERS: ModelProviderGroup[] = [];

function buildModelIndex(providers: ModelProviderGroup[]) {
  const map = new Map<string, pi.Model<pi.Api>>();
  for (const group of providers) {
    for (const model of group.models) {
      map.set(`${model.provider}:${model.id}`, model);
    }
  }
  return map;
}

export {
  firstAvailableModel,
  isModelAvailable,
  resolveModelConfig,
} from "@llm-space/core/thread";

export function ModelProvider({
  client,
  children,
  fallback = null,
}: {
  client: ModelClient;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const controllerRef = useRef<ModelCatalogController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new ModelCatalogController(client);
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useLayoutEffect(() => {
    controller.setClient(client);
  }, [client, controller]);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  // A client change represents a runtime switch. Keep the already-mounted
  // workspace alive, but expose an empty model view until that runtime's fetch
  // completes so consumers can never observe the previous runtime's models.
  const snapshotMatchesCommittedScope = snapshot.client === client;
  const providers = snapshotMatchesCommittedScope
    ? snapshot.providers
    : snapshot.providers === null
      ? null
      : EMPTY_MODEL_PROVIDERS;
  const defaultModel = snapshotMatchesCommittedScope
    ? snapshot.defaultModel
    : null;

  const contextValue = useMemo((): ModelContextValue | null => {
    if (!providers) {
      return null;
    }
    const index = buildModelIndex(providers);
    return {
      providers,
      removeProvider: controller.removeProvider,
      addProvider: controller.addProvider,
      addCustomProvider: controller.addCustomProvider,
      addProviderProfile: controller.addProviderProfile,
      updateProviderProfile: controller.updateProviderProfile,
      removeProviderProfile: controller.removeProviderProfile,
      updateProvider: controller.updateProvider,
      setModelEnabled: controller.setModelEnabled,
      setAllModelsEnabled: controller.setAllModelsEnabled,
      testModelConnection: controller.testModelConnection,
      removeCustomModel: controller.removeCustomModel,
      upsertCustomModel: controller.upsertCustomModel,
      setImageModelEnabled: controller.setImageModelEnabled,
      setAllImageModelsEnabled: controller.setAllImageModelsEnabled,
      removeCustomImageModel: controller.removeCustomImageModel,
      upsertCustomImageModel: controller.upsertCustomImageModel,
      refresh: controller.refresh,
      builtinProviders: controller.builtinProviders,
      getModel: (ref) => index.get(`${ref.provider}:${ref.id}`) ?? null,
      defaultModel,
      setDefaultModel: controller.setDefaultModel,
    };
  }, [
    providers,
    controller,
    defaultModel,
  ]);

  if (!contextValue) {
    return fallback;
  }

  return (
    <ModelContext.Provider value={contextValue}>
      {children}
    </ModelContext.Provider>
  );
}

function useModelProvider() {
  const ctx = useContext(ModelContext);
  if (!ctx) {
    throw new Error("hooks must be used within <ModelProvider>");
  }
  return ctx;
}

export function useModels(): ModelProviderGroup[] {
  return useModelProvider().providers;
}

/**
 * The fallback model for a thread with no saved model: the user's default when
 * set and available, else the first available model (`null` if none).
 */
export function useFirstAvailableModel(): ModelConfig | null {
  const { providers, defaultModel } = useModelProvider();
  return useMemo(
    () => resolveModelConfig(providers, null, defaultModel),
    [providers, defaultModel]
  );
}

/**
 * Resolve the model a thread should display/run with, given its saved model:
 * the saved model when still available, else the default, else first available.
 */
export function useResolveModelConfig(
  saved: ModelConfig | null | undefined
): ModelConfig | null {
  const { providers, defaultModel } = useModelProvider();
  return useMemo(
    () => resolveModelConfig(providers, saved, defaultModel),
    [providers, saved, defaultModel]
  );
}

/** The model used for ad-hoc text generation (e.g. `useStreamText`). */
export function useDefaultTextGenerationModel(): ModelConfig | null {
  return useFirstAvailableModel();
}

/** The user's chosen default model, or `null` for automatic (first available). */
export function useDefaultModel(): ModelConfig | null {
  return useModelProvider().defaultModel;
}

export function useSetDefaultModel(): (
  model: ModelConfig | null
) => Promise<void> {
  return useModelProvider().setDefaultModel;
}

export function useRemoveProvider(): (providerId: string) => Promise<void> {
  return useModelProvider().removeProvider;
}

export function useAddProvider(): (providerId: string) => Promise<void> {
  return useModelProvider().addProvider;
}

export function useAddCustomProvider(): (
  name: string,
  baseUrl: string
) => Promise<string> {
  return useModelProvider().addCustomProvider;
}

/** Fetch the builtin providers (with `apiKeyDetected` flags) from the host. */
export function useFetchBuiltinProviders(): () => Promise<
  ModelProviderGroup[]
> {
  return useModelProvider().builtinProviders;
}

export function useAddProviderProfile(): (
  providerId: string
) => Promise<string> {
  return useModelProvider().addProviderProfile;
}

export function useUpdateProviderProfile(): (
  providerId: string,
  profileId: string,
  fields: ProviderProfilePatch
) => Promise<void> {
  return useModelProvider().updateProviderProfile;
}

export function useRemoveProviderProfile(): (
  providerId: string,
  profileId: string
) => Promise<void> {
  return useModelProvider().removeProviderProfile;
}

export function useUpdateProvider(): (
  providerId: string,
  fields: {
    name?: string | null;
    api?:
      "anthropic-messages" | "openai-completions" | "openai-responses" | null;
    icon?: string | null;
  }
) => Promise<void> {
  return useModelProvider().updateProvider;
}

export function useSetModelEnabled(): (
  providerId: string,
  modelId: string,
  enabled: boolean
) => Promise<void> {
  return useModelProvider().setModelEnabled;
}

export function useSetAllModelsEnabled(): (
  providerId: string,
  enabled: boolean
) => Promise<void> {
  return useModelProvider().setAllModelsEnabled;
}

export function useTestModelConnection(): (
  providerId: string,
  modelId: string,
  candidate?: CustomModel,
  profileId?: string
) => Promise<void> {
  return useModelProvider().testModelConnection;
}

export function useRemoveCustomModel(): (
  providerId: string,
  modelId: string
) => Promise<void> {
  return useModelProvider().removeCustomModel;
}

export function useUpsertCustomModel(): (
  providerId: string,
  model: CustomModel,
  originalId?: string
) => Promise<void> {
  return useModelProvider().upsertCustomModel;
}

export function useSetImageModelEnabled(): (
  modelId: string,
  enabled: boolean
) => Promise<void> {
  return useModelProvider().setImageModelEnabled;
}

export function useSetAllImageModelsEnabled(): (
  enabled: boolean
) => Promise<void> {
  return useModelProvider().setAllImageModelsEnabled;
}

export function useRemoveCustomImageModel(): (
  modelId: string
) => Promise<void> {
  return useModelProvider().removeCustomImageModel;
}

export function useUpsertCustomImageModel(): (
  model: SeedreamImageModelDefinition,
  originalId?: string
) => Promise<void> {
  return useModelProvider().upsertCustomImageModel;
}

export function useRefreshModels(): () => Promise<void> {
  return useModelProvider().refresh;
}

export function useModel(ref: {
  id: string;
  provider: string;
}): pi.Model<pi.Api> | null {
  const ctx = useModelProvider();
  const { id, provider } = ref;
  return useMemo(() => ctx.getModel({ id, provider }), [ctx, id, provider]);
}
