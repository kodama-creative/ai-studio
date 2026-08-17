import { Container, ContainerModule } from "inversify";

import {
  ONBOARDING_NEEDS_DISCOVERY,
  OnboardingController,
} from "../onboarding/onboarding-controller";

import {
  createRendererSessionContainer,
  RENDERER_LIFECYCLE_CONTRIBUTION,
  RENDERER_SESSION_APPLICATION,
  RendererApplication,
} from "./lifecycle";
export const ONBOARDING_CONTROLLER = OnboardingController;

function onboardingSessionModule(needsDiscovery: boolean): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RendererApplication).toSelf().inSingletonScope();
    bind(RENDERER_SESSION_APPLICATION).toService(RendererApplication);
    bind(ONBOARDING_NEEDS_DISCOVERY).toConstantValue(needsDiscovery);
    bind(OnboardingController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(ONBOARDING_CONTROLLER);
  });
}

export function createOnboardingSessionContainer(
  parent: Container,
  needsDiscovery: boolean
): Container {
  return createRendererSessionContainer(parent, [
    onboardingSessionModule(needsDiscovery),
  ]);
}
