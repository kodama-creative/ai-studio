import type { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  WINDOW_RPC,
  type WindowRpc,
} from "../../shared/window-rpc";
import type {
  WindowApplicationApi,
  WindowApplicationEvents,
} from "../application/native-applications";

/** Owns the read/event-only Window namespace for one native window. */
export class WindowRpcServer implements RpcServer<WindowRpc> {
  readonly namespace = WINDOW_RPC;
  readonly streams = {};
  readonly eventSource;

  constructor(
    readonly requests: WindowApplicationApi,
    events: EventHub<WindowApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
