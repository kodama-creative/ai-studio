import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import {
  PluginCommandsRpcServer,
  PluginsRpcServer,
  PluginToolsRpcServer,
  ThreadStoragesRpcServer,
} from "../rpc/plugin-rpc-servers";

import {
  PluginCommandsApplication,
  PluginsApplication,
  PluginToolsApplication,
  ThreadStoragesApplication,
} from "./plugin-applications";

export const PLUGIN_APPLICATION_TOKENS = {
  plugins: desktopToken<PluginsApplication>("plugins", "application"),
  commands: desktopToken<PluginCommandsApplication>("plugin-commands", "application"),
  tools: desktopToken<PluginToolsApplication>("plugin-tools", "application"),
  threadStorages: desktopToken<ThreadStoragesApplication>(
    "thread-storages",
    "application"
  ),
} as const;

/** Register four narrow Plugin applications and their typed RPC adapters. */
export function pluginModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<PluginsApplication>(PLUGIN_APPLICATION_TOKENS.plugins)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new PluginsApplication(context.get(PROCESS_TOKENS.pluginManager))
      )
      .inSingletonScope();
    bind<PluginCommandsApplication>(PLUGIN_APPLICATION_TOKENS.commands)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new PluginCommandsApplication(
            context.get(PROCESS_TOKENS.pluginManager),
            context.get(PROCESS_TOKENS.pluginCommandExecutions)
          )
      )
      .inSingletonScope();
    bind<PluginToolsApplication>(PLUGIN_APPLICATION_TOKENS.tools)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new PluginToolsApplication(context.get(PROCESS_TOKENS.pluginManager))
      )
      .inSingletonScope();
    bind<ThreadStoragesApplication>(PLUGIN_APPLICATION_TOKENS.threadStorages)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ThreadStoragesApplication(
            context.get(PROCESS_TOKENS.pluginManager)
          )
      )
      .inSingletonScope();
    const contribute = (
      id: RpcServerContribution["id"],
      create: RpcServerContribution["create"]
    ) =>
      bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
        id,
        windows: ["main", "project"],
        create,
      });
    contribute("plugins.rpc", (scope) => {
      const app = scope.get<PluginsApplication>(
        PLUGIN_APPLICATION_TOKENS.plugins
      );
      return new PluginsRpcServer(app, app.events);
    });
    contribute("plugin-commands.rpc", (scope) => {
      const app = scope.get<PluginCommandsApplication>(
        PLUGIN_APPLICATION_TOKENS.commands
      );
      return new PluginCommandsRpcServer(app, app.events);
    });
    contribute(
      "plugin-tools.rpc",
      (scope) =>
        new PluginToolsRpcServer(scope.get(PLUGIN_APPLICATION_TOKENS.tools))
    );
    contribute(
      "thread-storages.rpc",
      (scope) =>
        new ThreadStoragesRpcServer(
          scope.get(PLUGIN_APPLICATION_TOKENS.threadStorages)
        )
    );
  });
}
