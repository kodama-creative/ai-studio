import { Container, ContainerModule } from "inversify";

import { AnalyticsSettingsController } from "../settings/analytics-settings-controller";
import { McpSettingsController } from "../settings/mcp-settings-controller";
import { AddProviderController } from "../settings/models/add-provider-controller";
import { ModelsSettingsController } from "../settings/models/models-settings-controller";
import { ProviderMetadataController } from "../settings/models/provider-metadata-controller";
import { ProviderProfileController } from "../settings/models/provider-profile-controller";
import { ProviderProfilesController } from "../settings/models/provider-profiles-controller";
import { NetworkSettingsController } from "../settings/network-settings-controller";
import { SearchSettingsController } from "../settings/search-settings-controller";
import { SkillsSettingsController } from "../settings/skills-settings-controller";
import { UpdateModeSettingsController } from "../settings/update-mode-settings-controller";

import {
  createRendererSessionContainer,
  RENDERER_LIFECYCLE_CONTRIBUTION,
  RENDERER_SESSION_APPLICATION,
  RendererApplication,
} from "./lifecycle";

export const ANALYTICS_SETTINGS_CONTROLLER = AnalyticsSettingsController;
export const UPDATE_MODE_SETTINGS_CONTROLLER = UpdateModeSettingsController;
export const NETWORK_SETTINGS_CONTROLLER = NetworkSettingsController;
export const SEARCH_SETTINGS_CONTROLLER = SearchSettingsController;
export const MCP_SETTINGS_CONTROLLER = McpSettingsController;
export const SKILLS_SETTINGS_CONTROLLER = SkillsSettingsController;
export const MODELS_SETTINGS_CONTROLLER = ModelsSettingsController;

/** Declare the fixed object graph owned by one Settings session. */
export function rendererSettingsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RendererApplication).toSelf().inSingletonScope();
    bind(RENDERER_SESSION_APPLICATION).toService(RendererApplication);

    bind(AnalyticsSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      AnalyticsSettingsController
    );
    bind(UpdateModeSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      UpdateModeSettingsController
    );
    bind(NetworkSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      NetworkSettingsController
    );
    bind(SearchSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(SearchSettingsController);

    bind(McpSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(McpSettingsController);
    bind(SkillsSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(SkillsSettingsController);

    bind(AddProviderController).toSelf().inSingletonScope();
    bind(ProviderMetadataController).toSelf().inSingletonScope();
    bind(ProviderProfilesController).toSelf().inSingletonScope();
    bind(ProviderProfileController).toSelf().inSingletonScope();
    bind(ModelsSettingsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(ModelsSettingsController);
  });
}

/** Create one Settings child Container parented to its renderer window. */
export function createSettingsContainer(parent: Container): Container {
  return createRendererSessionContainer(parent, [rendererSettingsModule()]);
}
