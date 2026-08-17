import type { Disposable } from "../../shared/disposable";
import type {
  RpcNamespaceInterface,
  RpcServer,
} from "../../shared/namespaced-rpc";

export interface AnyRpcServer extends RpcServer<RpcNamespaceInterface> {}

/** Narrow registration port exposed to feature-owned RPC contributions. */
export interface RpcRegistration {
  registerServer(server: AnyRpcServer): Disposable;
}

/** Multi-binding token for window-owned RPC declarations. */
export const RpcContribution = Symbol("RpcContribution");

/** Theia-style RPC declaration owned by one feature class. */
export interface RpcContribution {
  registerRpc(rpc: RpcRegistration): void;
}
