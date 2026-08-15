import type { PortableThreadSnapshot } from "@llm-space/core";
import type {
  GistThreadReader,
  GistThreadWriter,
} from "@llm-space/core/storage";
import { GIST_CONNECTOR_ID } from "@llm-space/core/storage";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
} from "@llm-space/studio";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { ThreadSharingRequests } from "../../shared/application-rpc";
import { buildWebShareUrl } from "../../shared/share";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";

import type { ModelsApplication } from "./models-application";
import { MODELS_APPLICATION } from "./models-module";
import type { DesktopPlaygroundApplication } from "./playground-application";
import { buildSharedThread } from "./thread-sharing";

export const THREAD_SHARING_APPLICATION =
  desktopToken<ThreadSharingApplication>("thread-sharing", "application");

/** Publishes immutable Playground copies through the Gist connector. */
export class ThreadSharingApplication implements ThreadSharingRequests {
  constructor(
    private readonly _playgrounds: DesktopPlaygroundApplication,
    private readonly _models: ModelsApplication,
    private readonly _writer: Pick<GistThreadWriter, "writeSnapshot">,
    private readonly _reader: Pick<GistThreadReader, "readSnapshot">
  ) {}

  async read(playgroundId: string): Promise<PortableThreadSnapshot> {
    const [playground, providers, defaultModel] = await Promise.all([
      this._playgrounds.load(playgroundId),
      this._models.list(),
      this._models.getDefault(),
    ]);
    if (playground === undefined) {
      throw new Error(`Playground "${playgroundId}" was not found.`);
    }
    return {
      kind: "llm-space.thread-snapshot",
      schemaVersion: 1,
      source: {
        product: "playground",
        productId: playground.id,
        sessionId: playground.sessionId,
        lane: playground.lane,
        leafId: playground.leafId,
      },
      thread: buildSharedThread(
        playgroundToThread(playground),
        providers,
        defaultModel
      ),
    };
  }

  async publish(
    playgroundId: string,
    meta: { title?: string; description?: string } = {}
  ) {
    const snapshot = await this.read(playgroundId);
    const locator = await this._writer.writeSnapshot(
      {
        ...snapshot,
        thread: {
          ...snapshot.thread,
          ...(meta.title === undefined ? {} : { title: meta.title }),
        },
      },
      { description: meta.description }
    );
    return {
      gistId: locator.id,
      shareUrl: buildWebShareUrl(GIST_CONNECTOR_ID, locator.id),
    };
  }

  importSnapshot(snapshot: PortableThreadSnapshot) {
    const document = threadToPlaygroundDocument(snapshot.thread, {});
    return this._playgrounds.create(document);
  }

  async importGist(gistId: string) {
    return this.importSnapshot(await this._reader.readSnapshot(gistId));
  }
}

/** Bind process-scoped thread sharing use cases. */
export function threadSharingApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ThreadSharingApplication>(THREAD_SHARING_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ThreadSharingApplication(
            context.get(PROCESS_TOKENS.playgroundApplication),
            context.get(MODELS_APPLICATION),
            context.get(PROCESS_TOKENS.gistWriter),
            context.get(PROCESS_TOKENS.gistReader)
          )
      )
      .inSingletonScope();
  });
}
