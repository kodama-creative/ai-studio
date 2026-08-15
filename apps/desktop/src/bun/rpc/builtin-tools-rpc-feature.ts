import type { ToolRegistry } from "@llm-space/runtime/tools";

import {
  BUILTIN_TOOLS_RPC,
  type BuiltinToolsRequests,
  type BuiltinToolsRpc,
} from "../../shared/builtin-tools-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

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
export class BuiltinToolsRpcContribution implements RpcContribution {
  constructor(private readonly _tools: ToolRegistry) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new BuiltinToolsRpcServer(this._tools));
  }
}
