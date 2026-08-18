import { ContainerModule, inject, injectable } from "inversify";

import {
  BUILTIN_TOOLS_RPC,
  type BuiltinToolsRequests,
  type BuiltinToolsRpc,
} from "../../shared/builtin-tools-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { BuiltInTools } from "./built-in-tools";

/** Expose the fixed built-in tool bundle to one renderer RPC registry. */
@injectable()
class BuiltInToolsRpcContribution implements RpcContributionApi {
  constructor(@inject(BuiltInTools) private readonly _tools: BuiltInTools) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: BuiltinToolsRequests = {
      list: () => Promise.resolve(this._tools.listTools()),
      call: (input) => this._tools.call(input),
    };
    rpc.registerServer({
      namespace: BUILTIN_TOOLS_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<BuiltinToolsRpc>);
  }
}

/** Bind Built-in Tools transport for one window. */
export function builtInToolsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(BuiltInToolsRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      BuiltInToolsRpcContribution
    );
  });
}
