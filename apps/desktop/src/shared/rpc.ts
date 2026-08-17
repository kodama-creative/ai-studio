import type { RPCSchema } from "electrobun";

import type { Command } from "./commands";
import type {
  NamespacedRpcEvent,
  NamespacedRpcRequest,
  NamespacedRpcRequestCancel,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
  NamespacedRpcStreamUnsubscribe,
} from "./namespaced-rpc";
import type { RpcResult } from "./rpc-error";

/**
 * Electrobun's transport envelope. Business methods, streams, and events are
 * declared by their owning namespace contracts rather than flattened here.
 */
export interface DesktopRPCType {
  bun: RPCSchema<{
    requests: {
      rpcNamespaceRequest: {
        params: NamespacedRpcRequest;
        response: RpcResult<unknown>;
      };
    };
    messages: {
      rpcNamespaceStreamSubscribe: NamespacedRpcStreamSubscribe;
      rpcNamespaceStreamUnsubscribe: NamespacedRpcStreamUnsubscribe;
      rpcNamespaceRequestCancel: NamespacedRpcRequestCancel;
    };
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      rpcNamespaceStreamEvent: NamespacedRpcStreamEvent;
      rpcNamespaceEvent: NamespacedRpcEvent;
      executeCommand: Command;
    };
  }>;
}
