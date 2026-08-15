import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  NATIVE_FILES_RPC,
  type NativeFilesRpc,
} from "../../shared/native-files-rpc";
import type { NativeFilesApplication } from "../application/native-applications";

/** Owns native filesystem inspection/reveal requests for one native window. */
export class NativeFilesRpcServer implements RpcServer<NativeFilesRpc> {
  readonly namespace = NATIVE_FILES_RPC;
  readonly streams = {};
  readonly requests: NativeFilesApplication;

  constructor(application: NativeFilesApplication) {
    this.requests = application;
  }
}
