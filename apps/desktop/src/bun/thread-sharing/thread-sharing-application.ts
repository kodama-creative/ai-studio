import { projectPiLogItems } from "@llm-space/acp/server";
import {
  threadFromSharedDocument,
  type SharedDocumentV1,
  type SharedSessionUpdate,
} from "@llm-space/core";
import { GIST_CONNECTOR_ID } from "@llm-space/core/storage";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
} from "@llm-space/studio";
import { inject, injectable } from "inversify";

import { buildWebShareUrl } from "../../shared/share";
import type { ThreadSharingRequests } from "../../shared/thread-sharing-rpc";
import { ModelsService } from "../models/models-service";
import { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

import { AuthenticatedGistStorage } from "./authenticated-gist-storage";
import { buildSharedThread } from "./thread-sharing";

/** Publishes immutable Playground copies through the Gist connector. */
@injectable()
export class ThreadSharingApplication implements ThreadSharingRequests {
  constructor(
    @inject(DesktopPlaygroundApplication)
    private readonly _playgrounds: Pick<
      DesktopPlaygroundApplication,
      "loadPlayground" | "createPlayground" | "readExecution"
    >,
    @inject(ModelsService)
    private readonly _models: ModelsService,
    @inject(AuthenticatedGistStorage)
    private readonly _gists: AuthenticatedGistStorage
  ) {}

  async read(playgroundId: string): Promise<SharedDocumentV1> {
    const [playground, providers, defaultModel] = await Promise.all([
      this._playgrounds.loadPlayground(playgroundId),
      this._models.list(),
      this._models.getDefault(),
    ]);
    if (playground === undefined) {
      throw new Error(`Playground "${playgroundId}" was not found.`);
    }
    const frame = await this._playgrounds.readExecution(playgroundId, 0);
    const display = buildSharedThread(
      playgroundToThread(playground),
      providers,
      defaultModel
    );
    return {
      kind: "llm-space.shared-document",
      version: 1,
      document: {
        title: playground.title,
        instructions: [...playground.agentSpec.instructions],
        ...(display.model === undefined
          ? {}
          : { model: structuredClone(display.model) }),
        tools: structuredClone(playground.agentSpec.tools),
        ...(playground.agentSpec.variables === undefined
          ? {}
          : {
              promptVariables: structuredClone(
                playground.agentSpec.variables
              ),
            }),
        ...(playground.agentSpec.variableVariants === undefined
          ? {}
          : {
              variableVariants: structuredClone(
                playground.agentSpec.variableVariants
              ),
            }),
      },
      conversation: {
        updates: projectPiLogItems(frame.items).filter(
          _isShareableUpdate
        ) as SharedSessionUpdate[],
      },
      ...(display.modelName === undefined
        ? {}
        : { display: { modelName: display.modelName } }),
    };
  }

  async publish(
    playgroundId: string,
    meta: { title?: string; description?: string } = {}
  ) {
    const snapshot = await this.read(playgroundId);
    const locator = await this._gists.writeDocument(
      {
        ...snapshot,
        document: {
          ...snapshot.document,
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

  importDocument(snapshot: SharedDocumentV1) {
    const document = threadToPlaygroundDocument(
      threadFromSharedDocument(snapshot),
      {}
    );
    return this._playgrounds.createPlayground(document);
  }

  async importGist(gistId: string) {
    return this.importDocument(await this._gists.readDocument(gistId));
  }
}

function _isShareableUpdate(
  update: ReturnType<typeof projectPiLogItems>[number]
): boolean {
  return (
    update.sessionUpdate === "user_message" ||
    update.sessionUpdate === "agent_message" ||
    update.sessionUpdate === "agent_thought" ||
    update.sessionUpdate === "tool_call_update" ||
    update.sessionUpdate === "usage_update"
  );
}
