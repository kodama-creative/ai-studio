import type { PluginManager } from "@llm-space/runtime/plugins";
import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
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
    bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
      id: "shared-import.rpc",
      windows: ["main"],
      create: (scope) => {
        const application = scope.get<SharedImportApplication>(
          SHARED_IMPORT_APPLICATION
        );
        return new SharedImportRpcServer(application, application.events);
      },
    });
  });
}
