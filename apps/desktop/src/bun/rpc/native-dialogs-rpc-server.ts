import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  NATIVE_DIALOGS_RPC,
  type NativeDialogsRpc,
} from "../../shared/native-dialogs-rpc";
import type { NativeDialogsApplication } from "../application/native-applications";

/** Owns native file/directory picker requests for one native window. */
export class NativeDialogsRpcServer implements RpcServer<NativeDialogsRpc> {
  readonly namespace = NATIVE_DIALOGS_RPC;
  readonly streams = {};
  readonly requests: NativeDialogsApplication;

  constructor(application: NativeDialogsApplication) {
    this.requests = application;
  }
}
