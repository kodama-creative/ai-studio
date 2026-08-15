import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  THREAD_SHARING_RPC,
  type ThreadSharingRpc,
} from "../../shared/thread-sharing-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { ThreadSharingApplication } from "./thread-sharing-application";

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
export function threadSharingRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ThreadSharingContribution)
      .toDynamicValue(
        (context) =>
          new ThreadSharingContribution(
            context.get(ThreadSharingApplication)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      ThreadSharingContribution
    );
  });
}
