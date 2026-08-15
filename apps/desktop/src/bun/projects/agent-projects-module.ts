import { ContainerModule, type ResolutionContext } from "inversify";

import {
  AGENT_PROJECTS_RPC,
  type AgentProjectsRpc,
} from "../../shared/agent-project-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { NATIVE_DIALOGS_APPLICATION } from "../native/native-dialogs-module";

import {
  AgentProjectsApplication,
  type DirectoryPicker,
} from "./agent-projects-application";

export const AGENT_PROJECTS_APPLICATION =
  desktopToken<AgentProjectsApplication>("agent-projects", "application");

class AgentProjectsRpcServer implements RpcServer<AgentProjectsRpc> {
  readonly namespace = AGENT_PROJECTS_RPC;
  readonly streams = {};
  readonly eventSource;

  constructor(readonly requests: AgentProjectsApplication) {
    this.eventSource = requests.events;
  }
}

/** Register main-window Agent Project use cases and RPC transport. */
export function agentProjectsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AgentProjectsApplication>(AGENT_PROJECTS_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AgentProjectsApplication(
            context.get(PROCESS_TOKENS.projectWindows),
            context.get<DirectoryPicker>(NATIVE_DIALOGS_APPLICATION)
          )
      )
      .inSingletonScope();
  });
}

class AgentProjectsCommandContribution implements CommandContributionApi {
  constructor(private readonly _application: AgentProjectsApplication) {}

  /** Register the native project picker command for every desktop window. */
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("agentProjects.open", {
      execute: (command) => void this._application.open(command.args.rootPath),
    });
  }
}

class AgentProjectsRpcContribution implements RpcContributionApi {
  constructor(private readonly _application: AgentProjectsApplication) {}

  /** Expose project catalog operations only to the Main renderer. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AgentProjectsRpcServer(this._application));
  }
}

/** Bind window-owned Agent Project adapters without exposing the DI scope. */
export function agentProjectsContributionsModule(
  includeRpc: boolean
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AgentProjectsCommandContribution)
      .toDynamicValue(
        (context) =>
          new AgentProjectsCommandContribution(
            context.get(AGENT_PROJECTS_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      AgentProjectsCommandContribution
    );
    if (includeRpc) {
      bind(AgentProjectsRpcContribution)
        .toDynamicValue(
          (context) =>
            new AgentProjectsRpcContribution(
              context.get(AGENT_PROJECTS_APPLICATION)
            )
        )
        .inSingletonScope();
      bind<RpcContributionApi>(RpcContribution).toService(
        AgentProjectsRpcContribution
      );
    }
  });
}
