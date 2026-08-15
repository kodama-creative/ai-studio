import { ContainerModule } from "inversify";

import {
  THREAD_SHARING_RPC,
  type ThreadSharingRpc,
} from "../../shared/application-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  THREAD_SHARING_APPLICATION,
  type ThreadSharingApplication,
} from "../application/thread-sharing-application";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class ThreadSharingRpcServer implements RpcServer<ThreadSharingRpc> {
  readonly namespace = THREAD_SHARING_RPC;
  readonly streams = {};

  constructor(readonly requests: ThreadSharingApplication) {}
}

class ThreadSharingContribution implements RpcContributionApi {
  constructor(private readonly _application: ThreadSharingApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new ThreadSharingRpcServer(this._application));
  }
}

/** Bind thread-sharing transport as one window contribution. */
export function threadSharingRpcModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ThreadSharingContribution)
      .toDynamicValue(
        () =>
          new ThreadSharingContribution(
            scope.get(THREAD_SHARING_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      ThreadSharingContribution
    );
  });
}
