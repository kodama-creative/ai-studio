import { NetworkSettingsManager } from "@llm-space/runtime/network";
import { ContainerModule } from "inversify";

/** Bind the process-owned network settings authority. */
export function networkModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NetworkSettingsManager).toSelf().inSingletonScope();
  });
}
