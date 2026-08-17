import { BrowserView } from "electrobun/bun";

import type { DesktopRPCType } from "../../shared/rpc";
import type { RpcRegistry } from "../di/rpc-registry";

/**
 * The stream handler references its RPC instance inside the initializer, so an
 * explicit annotation keeps TypeScript from inferring the recursive value as
 * `any`.
 */
export type MainWindowRPC = ReturnType<
  typeof BrowserView.defineRPC<DesktopRPCType>
>;

export interface MainWindowRPCController {
  readonly rpc: MainWindowRPC;
}

export interface MainWindowRPCDependencies {
  rpcRegistry: RpcRegistry;
}

const MAX_REQUEST_TIME_MS = 5 * 60_000 + 10_000;

export function createMainWindowRPC({
  rpcRegistry,
}: MainWindowRPCDependencies): MainWindowRPCController {
  const rpc: MainWindowRPC = BrowserView.defineRPC<DesktopRPCType>({
    maxRequestTime: MAX_REQUEST_TIME_MS,
    handlers: {
      requests: {
        rpcNamespaceRequest: (input) => rpcRegistry.request(input),
      },
      messages: {
        rpcNamespaceStreamSubscribe: (input) => rpcRegistry.subscribe(input),
        rpcNamespaceStreamUnsubscribe: ({ subscriptionId }) =>
          rpcRegistry.unsubscribe(subscriptionId),
        rpcNamespaceRequestCancel: ({ requestId }) =>
          rpcRegistry.cancelRequest(requestId),
      },
    },
  });
  return { rpc };
}
