import type {
  RpcNamespaceInterface,
  RpcServer,
} from "../../shared/namespaced-rpc";

import type { RpcRegistry } from "./rpc-registry";

export interface AnyRpcServer extends RpcServer<RpcNamespaceInterface> {}

/** Multi-binding token for window-owned RPC declarations. */
export const RpcContribution = Symbol.for(
  "@llm-space/desktop/rpc/contribution"
);

/** Theia-style RPC declaration owned by one feature class. */
export interface RpcContribution {
  registerRpc(rpc: RpcRegistry): void;
}
