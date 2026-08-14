import type { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  APP_DIRECTORIES_RPC,
  NATIVE_DIALOGS_RPC,
  NATIVE_FILES_RPC,
  WINDOW_RPC,
  type AppDirectoriesRpc,
  type NativeDialogsRpc,
  type NativeFilesRpc,
  type WindowRpc,
} from "../../shared/native-rpc";
import type {
  AppDirectoriesApplicationApi,
  NativeDialogsApplication,
  NativeFilesApplication,
  WindowApplicationEvents,
  WindowApplicationApi,
} from "../application/native-applications";

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
export class NativeDialogsRpcServer implements RpcServer<NativeDialogsRpc> {
  readonly namespace = NATIVE_DIALOGS_RPC;
  readonly streams = {};
  readonly requests: NativeDialogsApplication;
  constructor(application: NativeDialogsApplication) {
    this.requests = application;
  }
}
export class NativeFilesRpcServer implements RpcServer<NativeFilesRpc> {
  readonly namespace = NATIVE_FILES_RPC;
  readonly streams = {};
  readonly requests: NativeFilesApplication;
  constructor(application: NativeFilesApplication) {
    this.requests = application;
  }
}
export class AppDirectoriesRpcServer implements RpcServer<AppDirectoriesRpc> {
  readonly namespace = APP_DIRECTORIES_RPC;
  readonly streams = {};
  readonly requests: AppDirectoriesApplicationApi;
  constructor(application: AppDirectoriesApplicationApi) {
    this.requests = application;
  }
}
