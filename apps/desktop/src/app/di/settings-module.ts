import {
  DEFAULT_NETWORK_SETTINGS,
  DEFAULT_SEARCH_SETTINGS,
  type NetworkSettings,
  type SearchSettings,
  type SystemProxyDetection,
} from "@llm-space/core";
import { ContainerModule, type ResolutionContext } from "inversify";

import { createNetworkClient, type NetworkClient } from "@/client/network";
import {
  DEFAULT_ANALYTICS_SETTINGS,
  type AnalyticsStatus,
} from "@/shared/analytics";
import { DEFAULT_UPDATE_MODE, type UpdateMode } from "@/shared/updates";

import { McpSettingsController } from "../settings/mcp-settings-controller";
import { AddProviderController } from "../settings/models/add-provider-controller";
import { ModelsSettingsController } from "../settings/models/models-settings-controller";
import { ProviderMetadataController } from "../settings/models/provider-metadata-controller";
import { ProviderProfileController } from "../settings/models/provider-profile-controller";
import { ProviderProfilesController } from "../settings/models/provider-profiles-controller";
import { SettingsFormController } from "../settings/settings-form-controller";
import { SkillsSettingsController } from "../settings/skills-settings-controller";

import {
  MCP_CLIENT,
  MODEL_CATALOG_CONTROLLER,
  NATIVE_DIALOGS_CLIENT,
  NATIVE_FILES_CLIENT,
  RENDERER_EVENTS,
  SEARCH_CLIENT,
  SKILLS_CLIENT,
  UPDATES_CLIENT,
} from "./common-module";
import { RENDERER_LIFECYCLE_CONTRIBUTION, RendererScope } from "./lifecycle";
import { ANALYTICS_CLIENT } from "./main-window-module";
import { rendererToken, resolveRenderer } from "./tokens";

export const NETWORK_CLIENT = rendererToken<NetworkClient>("network", "client");
export const ANALYTICS_SETTINGS_CONTROLLER = rendererToken<
  SettingsFormController<AnalyticsStatus>
>("settings", "analytics-controller");
export const UPDATE_MODE_SETTINGS_CONTROLLER = rendererToken<
  SettingsFormController<UpdateMode>
>("settings", "update-mode-controller");
export const NETWORK_SETTINGS_CONTROLLER = rendererToken<
  SettingsFormController<NetworkSettings, SystemProxyDetection | null>
>("settings", "network-controller");
export const SEARCH_SETTINGS_CONTROLLER = rendererToken<
  SettingsFormController<SearchSettings>
>("settings", "search-controller");
export const MCP_SETTINGS_CONTROLLER = rendererToken<McpSettingsController>(
  "settings",
  "mcp-controller"
);
export const SKILLS_SETTINGS_CONTROLLER =
  rendererToken<SkillsSettingsController>("settings", "skills-controller");
export const MODELS_SETTINGS_CONTROLLER =
  rendererToken<ModelsSettingsController>("settings", "models-controller");
const ADD_PROVIDER_CONTROLLER = rendererToken<AddProviderController>(
  "settings",
  "add-provider-controller"
);
const PROVIDER_METADATA_CONTROLLER = rendererToken<ProviderMetadataController>(
  "settings",
  "provider-metadata-controller"
);
const PROVIDER_PROFILES_CONTROLLER = rendererToken<ProviderProfilesController>(
  "settings",
  "provider-profiles-controller"
);
const PROVIDER_PROFILE_CONTROLLER = rendererToken<ProviderProfileController>(
  "settings",
  "provider-profile-controller"
);

export function rendererSettingsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NETWORK_CLIENT).toConstantValue(createNetworkClient());

    bind(ANALYTICS_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const client = resolveRenderer(context, ANALYTICS_CLIENT);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new SettingsFormController<AnalyticsStatus>({
          initialSettings: { ...DEFAULT_ANALYTICS_SETTINGS, available: true },
          initialContext: undefined,
          loadSettings: () => client.getSettings(),
          saveSettings: (status) => client.setEnabled(status.enabled),
          notifySaveError: (error) =>
            events.emit("settings:save-failed", "analytics setting", error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      ANALYTICS_SETTINGS_CONTROLLER
    );

    bind(UPDATE_MODE_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const client = resolveRenderer(context, UPDATES_CLIENT);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new SettingsFormController<UpdateMode>({
          initialSettings: DEFAULT_UPDATE_MODE,
          initialContext: undefined,
          loadSettings: () => client.getMode(),
          saveSettings: async (mode) => {
            await client.setMode(mode);
            return mode;
          },
          notifySaveError: (error) =>
            events.emit(
              "settings:save-failed",
              "software update setting",
              error
            ),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      UPDATE_MODE_SETTINGS_CONTROLLER
    );

    bind(NETWORK_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const client = resolveRenderer(context, NETWORK_CLIENT);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new SettingsFormController<
          NetworkSettings,
          SystemProxyDetection | null
        >({
          initialSettings: DEFAULT_NETWORK_SETTINGS,
          initialContext: null,
          loadSettings: () => client.get(),
          saveSettings: (settings) => client.set(settings),
          loadContext: () => client.detectSystemProxy(),
          notifySaveError: (error) =>
            events.emit("settings:save-failed", "network settings", error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      NETWORK_SETTINGS_CONTROLLER
    );

    bind(SEARCH_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const client = resolveRenderer(context, SEARCH_CLIENT);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new SettingsFormController<SearchSettings>({
          initialSettings: DEFAULT_SEARCH_SETTINGS,
          initialContext: undefined,
          loadSettings: () => client.get(),
          saveSettings: (settings) => client.set(settings),
          notifySaveError: (error) =>
            events.emit("settings:save-failed", "search settings", error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(SEARCH_SETTINGS_CONTROLLER);

    bind(MCP_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new McpSettingsController({
          client: resolveRenderer(context, MCP_CLIENT),
          notifySuccess: (title, description) =>
            events.emit(
              "notification:success",
              description ? `${title}: ${description}` : title
            ),
          notifyError: (title, error) =>
            events.emit("notification:error", title, error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(MCP_SETTINGS_CONTROLLER);

    bind(SKILLS_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const events = resolveRenderer(context, RENDERER_EVENTS);
        const dialogs = resolveRenderer(context, NATIVE_DIALOGS_CLIENT);
        const files = resolveRenderer(context, NATIVE_FILES_CLIENT);
        return new SkillsSettingsController({
          client: resolveRenderer(context, SKILLS_CLIENT),
          browseForPath: () => dialogs.pickDirectory(),
          revealPath: (path) => files.reveal(path),
          notifyError: (title, error) =>
            events.emit("notification:error", title, error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(SKILLS_SETTINGS_CONTROLLER);

    bind(ADD_PROVIDER_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new AddProviderController({
          fetchBuiltinProviders: catalog.builtinProviders,
          addBuiltinProvider: catalog.addProvider,
          addCustomProvider: () =>
            catalog.addCustomProvider("Custom provider", ""),
          providerAdded: (providerId) =>
            events.emit("models:provider-added", providerId),
          addFailed: (providerName, error) =>
            events.emit(
              "models:mutation-failed",
              { operation: "add-provider", providerName },
              error
            ),
        });
      })
      .inSingletonScope();
    bind(PROVIDER_METADATA_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new ProviderMetadataController(null, {
          updateProvider: catalog.updateProvider,
          saveFailed: (field, error) =>
            events.emit(
              "models:mutation-failed",
              { operation: "save-provider-metadata", field },
              error
            ),
        });
      })
      .inSingletonScope();
    bind(PROVIDER_PROFILES_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new ProviderProfilesController(null, {
          addProfile: catalog.addProviderProfile,
          removeProfile: catalog.removeProviderProfile,
          mutationFailed: (mutation, error) =>
            events.emit(
              "models:mutation-failed",
              { operation: "mutate-provider-profiles", mutation },
              error
            ),
        });
      })
      .inSingletonScope();
    bind(PROVIDER_PROFILE_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new ProviderProfileController(null, {
          updateProfile: catalog.updateProviderProfile,
          saveFailed: (field, error) =>
            events.emit(
              "models:mutation-failed",
              { operation: "save-provider-profile", field },
              error
            ),
        });
      })
      .inSingletonScope();

    bind(MODELS_SETTINGS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new ModelsSettingsController(
          catalog.getSnapshot().providers ?? [],
          {
            catalog: {
              read: () => catalog.getSnapshot().providers ?? [],
              subscribe: catalog.subscribe,
            },
            subscribeProviderAdded: (listener) => {
              events.on("models:provider-added", listener);
              return () => events.off("models:provider-added", listener);
            },
            fetchBuiltinProviders: catalog.builtinProviders,
            addBuiltinProvider: catalog.addProvider,
            addCustomProvider: () =>
              catalog.addCustomProvider("Custom provider", ""),
            removeProvider: catalog.removeProvider,
            updateProvider: catalog.updateProvider,
            addProviderProfile: catalog.addProviderProfile,
            removeProviderProfile: catalog.removeProviderProfile,
            updateProviderProfile: catalog.updateProviderProfile,
            mutationFailed: (failure, error) =>
              events.emit("models:mutation-failed", failure, error),
          },
          {
            addProvider: resolveRenderer(context, ADD_PROVIDER_CONTROLLER),
            metadata: resolveRenderer(context, PROVIDER_METADATA_CONTROLLER),
            profiles: resolveRenderer(context, PROVIDER_PROFILES_CONTROLLER),
            profile: resolveRenderer(context, PROVIDER_PROFILE_CONTROLLER),
          }
        );
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(MODELS_SETTINGS_CONTROLLER);
  });
}

export function createSettingsScope(parent: RendererScope): RendererScope {
  return new RendererScope({ parent, modules: [rendererSettingsModule()] });
}
