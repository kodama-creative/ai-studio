import { ContainerModule, inject, injectable } from "inversify";

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

@injectable()
class ThreadSharingContribution implements RpcContributionApi {
  constructor(
    @inject(ThreadSharingApplication)
    private readonly _application: ThreadSharingApplication
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: THREAD_SHARING_RPC,
      requests: this._application,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<ThreadSharingRpc>);
  }
}

/** Bind thread-sharing transport as one window contribution. */
export function threadSharingRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ThreadSharingContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      ThreadSharingContribution
    );
  });
}
