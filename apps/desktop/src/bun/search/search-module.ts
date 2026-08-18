import { SearchSettingsManager } from "@llm-space/runtime/search";
import { ContainerModule } from "inversify";

/** Bind the process-owned search settings authority. */
export function searchModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SearchSettingsManager).toSelf().inSingletonScope();
  });
}
