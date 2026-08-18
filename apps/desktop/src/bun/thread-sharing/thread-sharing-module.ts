import { ContainerModule } from "inversify";

import { AuthenticatedGistStorage } from "./authenticated-gist-storage";
import { ThreadSharingApplication } from "./thread-sharing-application";

/** Bind process-scoped Thread Sharing use cases. */
export function threadSharingModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AuthenticatedGistStorage).toSelf().inSingletonScope();
    bind(ThreadSharingApplication).toSelf().inSingletonScope();
  });
}
