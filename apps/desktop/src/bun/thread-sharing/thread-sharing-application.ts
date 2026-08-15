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

import { buildWebShareUrl } from "../../shared/share";
import type { ThreadSharingRequests } from "../../shared/thread-sharing-rpc";
import type { ModelsApplication } from "../models/models-application";
import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

import { buildSharedThread } from "./thread-sharing";

/** Publishes immutable Playground copies through the Gist connector. */
export class ThreadSharingApplication implements ThreadSharingRequests {
  constructor(
    private readonly _playgrounds: Pick<
      DesktopPlaygroundApplication,
      "loadPlayground" | "createPlayground"
    >,
    private readonly _models: ModelsApplication,
    private readonly _writer: Pick<GistThreadWriter, "writeSnapshot">,
    private readonly _reader: Pick<GistThreadReader, "readSnapshot">
  ) {}

  async read(playgroundId: string): Promise<PortableThreadSnapshot> {
    const [playground, providers, defaultModel] = await Promise.all([
      this._playgrounds.loadPlayground(playgroundId),
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
    return this._playgrounds.createPlayground(document);
  }

  async importGist(gistId: string) {
    return this.importSnapshot(await this._reader.readSnapshot(gistId));
  }
}
