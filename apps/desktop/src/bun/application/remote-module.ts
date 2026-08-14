import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { RemoteServersRpcServer } from "../rpc/remote-servers-rpc-server";

import { RemoteServersApplication } from "./remote-servers-application";

export const REMOTE_SERVERS_APPLICATION = desktopToken<RemoteServersApplication>(
  "remote-servers",
  "application"
);

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
    bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
      id: "remote-servers.rpc",
      windows: ["main"],
      create: (scope) => {
        const application = scope.get<RemoteServersApplication>(
          REMOTE_SERVERS_APPLICATION
        );
        return new RemoteServersRpcServer(application, application.events);
      },
    });
  });
}
