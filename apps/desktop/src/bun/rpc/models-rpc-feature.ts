import type {
  ModelsRequests,
  ModelsRpc,
} from "../../shared/models-rpc";
import { MODELS_RPC } from "../../shared/models-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { ModelsApplication } from "../application/runtime-applications";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";


class ModelsRpcServer implements RpcServer<ModelsRpc> {
  readonly namespace = MODELS_RPC;
  readonly requests: ModelsRequests;
  readonly streams = {};

  constructor(application: ModelsApplication) {
    this.requests = application;
  }
}

/** Owns the Models namespace for one native window. */
export class ModelsRpcContribution implements RpcContribution {
  constructor(private readonly _application: ModelsApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new ModelsRpcServer(this._application));
  }
}
