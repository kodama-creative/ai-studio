import type { PluginManager } from "@llm-space/runtime/plugins";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import type { ProjectWindowManager } from "../projects/project-window-manager";
import { SharedImportRpcServer } from "../rpc/shared-import-rpc-server";

import { SharedImportApplication } from "./shared-import-application";

export const SHARED_IMPORT_APPLICATION = desktopToken<SharedImportApplication>(
  "shared-import",
  "application"
);

/** Register shared import routing, cancellation, and renderer status events. */
export function sharedImportModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<SharedImportApplication>(SHARED_IMPORT_APPLICATION)
      .toDynamicValue((context: ResolutionContext) => {
        const plugins = context.get<PluginManager>(
          PROCESS_TOKENS.pluginManager
        );
        return new SharedImportApplication({
          localFs: context.get(PROCESS_TOKENS.localFs),
          githubAuth: context.get(PROCESS_TOKENS.githubAuth),
          threadStorages: plugins.threadStorages,
          openAgentProject: (rootPath) =>
            context
              .get<ProjectWindowManager>(PROCESS_TOKENS.projectWindows)
              .openProject(rootPath),
        });
      })
      .inSingletonScope();
  });
}

class SharedImportContribution implements RpcContributionApi {
  constructor(private readonly _application: SharedImportApplication) {}

  /** Register shared-link import requests and progress events. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new SharedImportRpcServer(this._application, this._application.events)
    );
  }
}

/** Bind the Main-only shared import contribution. */
export function sharedImportContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SharedImportContribution)
      .toDynamicValue(
        () => new SharedImportContribution(scope.get(SHARED_IMPORT_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      SharedImportContribution
    );
  });
}
