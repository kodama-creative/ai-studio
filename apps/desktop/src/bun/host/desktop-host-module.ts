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

import { DesktopHost } from "./desktop-host";

/** Owns bundled-tool discovery and execution RPC for one native window. */
@injectable()
class BuiltinToolsRpcContribution implements RpcContributionApi {
  constructor(@inject(DesktopHost) private readonly _host: DesktopHost) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: BuiltinToolsRequests = {
      list: () => Promise.resolve(this._host.tools.listTools()),
      call: (input) => this._host.tools.call(input),
    };
    rpc.registerServer({
      namespace: BUILTIN_TOOLS_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<BuiltinToolsRpc>);
  }
}

/** Bind bundled-tool RPC as one window contribution. */
export function builtinToolsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(BuiltinToolsRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      BuiltinToolsRpcContribution
    );
  });
}
