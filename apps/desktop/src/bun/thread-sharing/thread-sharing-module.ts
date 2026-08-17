import { ContainerModule } from "inversify";

import { ThreadSharingApplication } from "./thread-sharing-application";
export {
  GIST_THREAD_READER,
  GIST_THREAD_WRITER,
} from "./thread-sharing-identifiers";

/** Bind process-scoped Thread Sharing use cases. */
export function threadSharingModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ThreadSharingApplication).toSelf().inSingletonScope();
  });
}
