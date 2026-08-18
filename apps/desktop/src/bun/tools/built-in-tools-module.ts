import { ContainerModule } from "inversify";

import { BuiltInTools } from "./built-in-tools";

/** Bind the immutable process-owned built-in tool bundle. */
export function builtInToolsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(BuiltInTools).toSelf().inSingletonScope();
  });
}
