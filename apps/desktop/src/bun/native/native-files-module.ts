import { ContainerModule } from "inversify";

import { NativeFilesService } from "./native-files-service";

/** Bind the process-owned native file capability. */
export function nativeFilesModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeFilesService).toSelf().inSingletonScope();
  });
}
