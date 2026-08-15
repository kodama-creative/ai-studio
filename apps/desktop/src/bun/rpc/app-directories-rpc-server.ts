import {
  APP_DIRECTORIES_RPC,
  type AppDirectoriesRpc,
} from "../../shared/app-directories-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { AppDirectoriesApplicationApi } from "../application/native-applications";

/** Owns LLM Space application-directory requests for one native window. */
export class AppDirectoriesRpcServer implements RpcServer<AppDirectoriesRpc> {
  readonly namespace = APP_DIRECTORIES_RPC;
  readonly streams = {};
  readonly requests: AppDirectoriesApplicationApi;

  constructor(application: AppDirectoriesApplicationApi) {
    this.requests = application;
  }
}
