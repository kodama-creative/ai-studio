import { ContainerModule, type ResolutionContext } from "inversify";

import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
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
  commands: desktopToken<PluginCommandsApplication>(
    "plugin-commands",
    "application"
  ),
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
  });
}

class PluginContribution implements RpcContributionApi {
  constructor(
    private readonly _plugins: PluginsApplication,
    private readonly _commands: PluginCommandsApplication,
    private readonly _tools: PluginToolsApplication,
    private readonly _threadStorages: ThreadStoragesApplication
  ) {}

  /** Register Plugin requests, command events, tools, and storage connectors. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new PluginsRpcServer(this._plugins, this._plugins.events)
    );
    rpc.registerServer(
      new PluginCommandsRpcServer(this._commands, this._commands.events)
    );
    rpc.registerServer(new PluginToolsRpcServer(this._tools));
    rpc.registerServer(new ThreadStoragesRpcServer(this._threadStorages));
  }
}

/** Bind Plugin RPC declarations as one window-scoped contribution. */
export function pluginContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PluginContribution)
      .toDynamicValue(
        () =>
          new PluginContribution(
            scope.get(PLUGIN_APPLICATION_TOKENS.plugins),
            scope.get(PLUGIN_APPLICATION_TOKENS.commands),
            scope.get(PLUGIN_APPLICATION_TOKENS.tools),
            scope.get(PLUGIN_APPLICATION_TOKENS.threadStorages)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(PluginContribution);
  });
}
