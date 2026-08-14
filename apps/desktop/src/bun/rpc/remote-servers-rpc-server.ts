import type { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  REMOTE_SERVERS_RPC,
  type RemoteServersRpc,
} from "../../shared/remote-rpc";
import type {
  RemoteServersApplicationApi,
  RemoteServersApplicationEvents,
} from "../application/remote-servers-application";

/** Typed transport adapter for Remote Server lifecycle and status events. */
export class RemoteServersRpcServer implements RpcServer<RemoteServersRpc> {
  readonly namespace = REMOTE_SERVERS_RPC;
  readonly streams = {};
  readonly eventSource;

  constructor(
    readonly requests: RemoteServersApplicationApi,
    events: EventHub<RemoteServersApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
