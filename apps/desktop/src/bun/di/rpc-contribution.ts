import type { RpcNamespaceInterface, RpcServer } from "../../shared/namespaced-rpc";

import type { DesktopWindowScope } from "./process-container";

export type DesktopWindowKind = "main" | "project";

export interface AnyRpcServer extends RpcServer<RpcNamespaceInterface> {}

/** Lazy business module declaration resolved against one owning window scope. */
export interface RpcServerContribution {
  readonly id: `${string}.${string}`;
  readonly windows: readonly DesktopWindowKind[];
  create(scope: DesktopWindowScope): AnyRpcServer;
}

/** Construct only the RPC modules explicitly allowed for a window kind. */
export function createWindowRpcServers(
  scope: DesktopWindowScope,
  kind: DesktopWindowKind
): AnyRpcServer[] {
  const seen = new Set<string>();
  return scope
    .getAll<RpcServerContribution>(RPC_SERVER_CONTRIBUTION)
    .filter((contribution) => contribution.windows.includes(kind))
    .map((contribution) => {
      if (seen.has(contribution.id)) {
        throw new Error(
          `RPC contribution "${contribution.id}" is registered more than once.`
        );
      }
      seen.add(contribution.id);
      return scope.own(contribution.create(scope));
    });
}

export const RPC_SERVER_CONTRIBUTION = Symbol.for(
  "@llm-space/desktop/rpc/contribution/server"
);
