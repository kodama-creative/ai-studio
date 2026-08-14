import { ContainerModule, type ResolutionContext } from "inversify";

import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { RemoteServersRpcServer } from "../rpc/remote-servers-rpc-server";

import { RemoteServersApplication } from "./remote-servers-application";

export const REMOTE_SERVERS_APPLICATION =
  desktopToken<RemoteServersApplication>("remote-servers", "application");

/** Register Remote Server lifecycle and status event bridging. */
export function remoteModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<RemoteServersApplication>(REMOTE_SERVERS_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new RemoteServersApplication(
            context.get(PROCESS_TOKENS.remoteServerManager)
          )
      )
      .inSingletonScope();
  });
}

class RemoteServersContribution implements RpcContributionApi {
  constructor(private readonly _application: RemoteServersApplication) {}

  /** Register remote runtime lifecycle requests and status events. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new RemoteServersRpcServer(this._application, this._application.events)
    );
  }
}

/** Bind the Main-only remote server contribution. */
export function remoteContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemoteServersContribution)
      .toDynamicValue(
        () =>
          new RemoteServersContribution(scope.get(REMOTE_SERVERS_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      RemoteServersContribution
    );
  });
}
