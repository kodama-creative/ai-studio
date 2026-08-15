import type {
  GistThreadReader,
  GistThreadWriter,
} from "@llm-space/core/storage";
import { ContainerModule, type ResolutionContext } from "inversify";

import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";
import { ModelsApplication } from "../models/models-application";
import { PLAYGROUND_APPLICATION } from "../playgrounds/playground-module";

import { ThreadSharingApplication } from "./thread-sharing-application";
import { threadSharingRpcModule } from "./thread-sharing-rpc-feature";

export const GIST_THREAD_READER = desktopToken<GistThreadReader>(
  "thread-sharing",
  "gist-reader"
);
export const GIST_THREAD_WRITER = desktopToken<GistThreadWriter>(
  "thread-sharing",
  "gist-writer"
);

/** Bind process-scoped Thread Sharing use cases and its window adapter. */
export function threadSharingModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ThreadSharingApplication)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ThreadSharingApplication(
            context.get(PLAYGROUND_APPLICATION),
            context.get(ModelsApplication),
            context.get(GIST_THREAD_WRITER),
            context.get(GIST_THREAD_READER)
          )
      )
      .inSingletonScope();
    bindWindowFeature(
      bind,
      windowFeature("thread-sharing", (scope) =>
        scope.load(threadSharingRpcModule())
      )
    );
  });
}
