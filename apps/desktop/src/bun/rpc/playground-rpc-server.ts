import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PLAYGROUND_RPC,
  type PlaygroundRequests,
  type PlaygroundRpc,
} from "../../shared/playground-rpc";
import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

/** Transport-only adapter for the durable Playground application. */
export class PlaygroundRpcServer implements RpcServer<PlaygroundRpc> {
  readonly namespace = PLAYGROUND_RPC;
  readonly requests: PlaygroundRequests;
  readonly streams = {};

  constructor(application: DesktopPlaygroundApplication) {
    this.requests = {
      list: () => application.listPlaygrounds(),
      create: (input) => application.createPlayground(input),
      load: (playgroundId) => application.loadPlayground(playgroundId),
      save: (playgroundId, document) =>
        application.savePlayground(playgroundId, document),
    };
  }
}
