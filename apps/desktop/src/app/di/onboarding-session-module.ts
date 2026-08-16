import { ContainerModule, type ResolutionContext } from "inversify";

import { OnboardingController } from "../onboarding/onboarding-controller";

import { MODEL_CATALOG_CONTROLLER, RENDERER_EVENTS } from "./common-module";
import { RENDERER_LIFECYCLE_CONTRIBUTION, RendererScope } from "./lifecycle";
import { rendererToken, resolveRenderer } from "./tokens";

export const ONBOARDING_NEEDS_DISCOVERY = rendererToken<boolean>(
  "onboarding",
  "needs-discovery"
);
export const ONBOARDING_CONTROLLER = rendererToken<OnboardingController>(
  "onboarding",
  "controller"
);

function onboardingSessionModule(needsDiscovery: boolean): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ONBOARDING_NEEDS_DISCOVERY).toConstantValue(needsDiscovery);
    bind(ONBOARDING_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new OnboardingController(
          {
            fetchBuiltinProviders: catalog.builtinProviders,
            addProvider: catalog.addProvider,
            notifyProviderAdded: (providerName) =>
              events.emit("onboarding:provider-added", providerName),
            notifyAddFailed: (error) =>
              events.emit("onboarding:add-failed", error),
          },
          resolveRenderer(context, ONBOARDING_NEEDS_DISCOVERY)
        );
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(ONBOARDING_CONTROLLER);
  });
}

export function createOnboardingSessionScope(
  parent: RendererScope,
  needsDiscovery: boolean
): RendererScope {
  return new RendererScope({
    parent,
    modules: [onboardingSessionModule(needsDiscovery)],
  });
}
