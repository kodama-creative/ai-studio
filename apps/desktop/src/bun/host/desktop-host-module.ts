import type { ToolRegistry } from "@llm-space/runtime/tools";
import { ContainerModule } from "inversify";

import {
  BUILTIN_TOOLS_RPC,
  type BuiltinToolsRequests,
  type BuiltinToolsRpc,
} from "../../shared/builtin-tools-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

import type { DesktopHost } from "./desktop-host";

export const DESKTOP_HOST = desktopToken<DesktopHost>(
  "desktop-host",
  "host"
);

class BuiltinToolsRpcServer implements RpcServer<BuiltinToolsRpc> {
  readonly namespace = BUILTIN_TOOLS_RPC;
  readonly streams = {};
  readonly requests: BuiltinToolsRequests;

  constructor(tools: ToolRegistry) {
    this.requests = {
      list: () => Promise.resolve(tools.listTools()),
      call: (input) => tools.call(input),
    };
  }
}

/** Owns bundled-tool discovery and execution RPC for one native window. */
class BuiltinToolsRpcContribution implements RpcContributionApi {
  constructor(private readonly _tools: ToolRegistry) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new BuiltinToolsRpcServer(this._tools));
  }
}

/** Bind bundled-tool RPC as one window contribution. */
export function builtinToolsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(BuiltinToolsRpcContribution)
      .toDynamicValue(
        (context) =>
          new BuiltinToolsRpcContribution(
            context.get<DesktopHost>(DESKTOP_HOST).tools
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      BuiltinToolsRpcContribution
    );
  });
}

/** Register bundled Tool discovery/execution as one window feature. */
export function desktopHostModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("builtin-tools", (scope) =>
        scope.load(builtinToolsRpcModule())
      )
    );
  });
}
