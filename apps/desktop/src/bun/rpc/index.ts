import { BrowserView } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import type { DesktopRPCType } from "../../shared/rpc";
import type { AnyRpcServer } from "../di/rpc-contribution";

import { NamespacedRpcServer } from "./namespaced-rpc-server";

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
  dispose(): Promise<void>;
}

export interface MainWindowRPCDependencies {
  executeCommand: (command: Command) => void;
  rpcServers: readonly AnyRpcServer[];
}

const MAX_REQUEST_TIME_MS = 5 * 60_000 + 10_000;

export function createMainWindowRPC({
  executeCommand,
  rpcServers,
}: MainWindowRPCDependencies): MainWindowRPCController {
  const namespaceServer = new NamespacedRpcServer({
    sendStreamEvent: (event) => rpc.send.rpcNamespaceStreamEvent(event),
    sendEvent: (event) => rpc.send.rpcNamespaceEvent(event),
  });
  for (const server of rpcServers) namespaceServer.register(server);
  const rpc: MainWindowRPC = BrowserView.defineRPC<DesktopRPCType>({
    maxRequestTime: MAX_REQUEST_TIME_MS,
    handlers: {
      requests: {
        rpcNamespaceRequest: (input) => namespaceServer.request(input),
      },
      messages: {
        rpcNamespaceStreamSubscribe: (input) =>
          namespaceServer.subscribe(input),
        rpcNamespaceStreamUnsubscribe: ({ subscriptionId }) =>
          namespaceServer.unsubscribe(subscriptionId),
        executeCommand: (command) => executeCommand(command),
      },
    },
  });
  return {
    rpc,
    async dispose() {
      await namespaceServer.dispose();
    },
  };
}
