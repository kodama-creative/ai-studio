import type { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  SHARED_IMPORT_RPC,
  type SharedImportRpc,
} from "../../shared/shared-import-rpc";
import type {
  SharedImportApplicationApi,
  SharedImportApplicationEvents,
} from "../application/shared-import-application";

/** Typed transport adapter for shared-thread import status and cancellation. */
export class SharedImportRpcServer implements RpcServer<SharedImportRpc> {
  readonly namespace = SHARED_IMPORT_RPC;
  readonly streams = {};
  readonly eventSource;
  constructor(
    readonly requests: SharedImportApplicationApi,
    events: EventHub<SharedImportApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
