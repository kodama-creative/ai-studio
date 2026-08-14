import { ContainerModule, type ResolutionContext } from "inversify";

import {
  COMMAND_HANDLER_CONTRIBUTION,
  type CommandHandlerContribution,
} from "../di/command-contribution";
import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { AgentProjectsRpcServer } from "../rpc/agent-projects-rpc-server";

import {
  AgentProjectsApplication,
  type AgentProjectsApplicationApi,
  type DirectoryPicker,
} from "./agent-projects-application";
import { NATIVE_APPLICATION_TOKENS } from "./native-module";

export const AGENT_PROJECTS_APPLICATION =
  desktopToken<AgentProjectsApplicationApi>("agent-projects", "application");

/** Register main-window Agent Project use cases and RPC transport. */
export function agentProjectsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AgentProjectsApplicationApi>(AGENT_PROJECTS_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AgentProjectsApplication(
            context.get(PROCESS_TOKENS.projectWindows),
            context.get<DirectoryPicker>(NATIVE_APPLICATION_TOKENS.dialogs)
          )
      )
      .inSingletonScope();
    bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
      id: "agent-projects.rpc",
      windows: ["main"],
      create: (scope) =>
        new AgentProjectsRpcServer(scope.get(AGENT_PROJECTS_APPLICATION)),
    });
    bind<CommandHandlerContribution>(
      COMMAND_HANDLER_CONTRIBUTION
    ).toConstantValue({
      id: "agent-projects.commands",
      windows: ["main", "project"],
      create: (scope) => {
        const projects = scope.get<AgentProjectsApplicationApi>(
          AGENT_PROJECTS_APPLICATION
        );
        return {
          commands: ["agentProjects.open"],
          execute() {
            void projects.pickAndOpen();
          },
        };
      },
    });
  });
}
