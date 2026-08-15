import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  ProviderConnectionRef,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export interface BuiltinToolsRequests {
  list(): Promise<BuiltinTool[]>;
  call(input: {
    name: string;
    arguments: Record<string, unknown>;
    config?: Record<string, unknown>;
    connection?: ProviderConnectionRef;
  }): Promise<BuiltinToolCallResponse>;
}

export type BuiltinToolsRpc = RequestRpcShape<BuiltinToolsRequests>;

export const BUILTIN_TOOLS_RPC = defineRpcNamespace<BuiltinToolsRpc>(
  "builtinTools",
  {
    requests: { list: true, call: true },
    streams: {},
    events: {},
  }
);
