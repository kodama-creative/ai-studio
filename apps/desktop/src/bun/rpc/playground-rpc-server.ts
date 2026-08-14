import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PLAYGROUND_RPC,
  type PlaygroundRpc,
} from "../../shared/playground-rpc";
import type { DesktopPlaygroundApplication } from "../application/playground-application";

/** Transport-only adapter for the durable Playground application. */
export class PlaygroundRpcServer implements RpcServer<PlaygroundRpc> {
  readonly namespace = PLAYGROUND_RPC;
  readonly requests;
  readonly streams;
  constructor(application: DesktopPlaygroundApplication) {
    this.requests = application;
    this.streams = application;
  }
}
