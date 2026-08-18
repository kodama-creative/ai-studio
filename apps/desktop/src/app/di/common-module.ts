import { ContainerModule } from "inversify";

import { COMMAND_SERVICE } from "@/commands/command-service";
import { RemoteCommandContribution } from "@/commands/remote-command-contribution";
import { RendererCommandRegistry } from "@/commands/renderer-command-registry";
import {
  ACP_SESSION_RPC,
  ACP_SESSION_SERVICE,
} from "@/shared/acp-session-rpc";
import {
  AGENT_PROJECTS_RPC,
  AGENT_PROJECTS_SERVICE,
  type AgentProjectsRpc,
} from "@/shared/agent-project-rpc";
import {
  APP_DIRECTORIES_RPC,
  APP_DIRECTORIES_SERVICE,
  type AppDirectoriesRpc,
} from "@/shared/app-directories-rpc";
import {
  AUXILIARY_GENERATION_RPC,
  AUXILIARY_GENERATION_SERVICE,
} from "@/shared/auxiliary-generation-rpc";
import {
  BUILTIN_TOOLS_RPC,
  BUILTIN_TOOLS_SERVICE,
} from "@/shared/builtin-tools-rpc";
import {
  GITHUB_ACCOUNT_RPC,
  GITHUB_ACCOUNT_SERVICE,
  type GithubAccountRpc,
} from "@/shared/github-account-rpc";
import { MCP_RPC, MCP_SERVICE } from "@/shared/mcp-rpc";
import {
  MODELS_RPC,
  MODELS_SERVICE,
  type ModelsRpc,
} from "@/shared/models-rpc";
import {
  createRpcClient,
  type RpcClient,
  type RpcClientTransport,
} from "@/shared/namespaced-rpc";
import {
  NATIVE_DIALOGS_RPC,
  NATIVE_DIALOGS_SERVICE,
  type NativeDialogsRpc,
} from "@/shared/native-dialogs-rpc";
import {
  NATIVE_FILES_RPC,
  NATIVE_FILES_SERVICE,
} from "@/shared/native-files-rpc";
import {
  NETWORK_RPC,
  NETWORK_SERVICE,
} from "@/shared/network-rpc";
import {
  PROMPT_FILES_RPC,
  PROMPT_FILES_SERVICE,
} from "@/shared/prompt-files-rpc";
import { SEARCH_RPC, SEARCH_SERVICE } from "@/shared/search-rpc";
import { SHELL_RPC, SHELL_SERVICE, type ShellRpc } from "@/shared/shell-rpc";
import { SKILLS_RPC, SKILLS_SERVICE, type SkillsRpc } from "@/shared/skills-rpc";
import {
  UPDATES_RPC,
  UPDATES_SERVICE,
  type UpdatesRpc,
} from "@/shared/updates-rpc";
import { WINDOW_RPC, WINDOW_SERVICE, type WindowRpc } from "@/shared/window-rpc";

import { DesktopModelClient } from "../../host/model-client";
import { DesktopModelCatalogController } from "../models/desktop-model-catalog-controller";
import { ModelsChangeController } from "../models/models-change-controller";
import { RendererNotificationService } from "../notifications/renderer-notification-service";
import { FullScreenController } from "../window/full-screen-controller";

import { RENDERER_LIFECYCLE_CONTRIBUTION } from "./lifecycle";

export function rendererCommonModule(
  transport: RpcClientTransport
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RendererNotificationService).toSelf().inSingletonScope();
    bind(RendererCommandRegistry).toSelf().inSingletonScope();
    bind(COMMAND_SERVICE).toService(RendererCommandRegistry);
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(RendererCommandRegistry);

    bind<RpcClient<ModelsRpc>>(MODELS_SERVICE).toConstantValue(
      createRpcClient(MODELS_RPC, transport)
    );
    bind(DesktopModelClient).toSelf().inSingletonScope();
    bind(DesktopModelCatalogController).toSelf().inSingletonScope();
    bind(ModelsChangeController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(ModelsChangeController);
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      DesktopModelCatalogController
    );

    bind<RpcClient<WindowRpc>>(WINDOW_SERVICE).toConstantValue(
      createRpcClient(WINDOW_RPC, transport)
    );
    bind<RpcClient<AgentProjectsRpc>>(AGENT_PROJECTS_SERVICE).toConstantValue(
      createRpcClient(AGENT_PROJECTS_RPC, transport)
    );
    bind<RpcClient<GithubAccountRpc>>(GITHUB_ACCOUNT_SERVICE).toConstantValue(
      createRpcClient(GITHUB_ACCOUNT_RPC, transport)
    );
    bind<RpcClient<ShellRpc>>(SHELL_SERVICE).toConstantValue(
      createRpcClient(SHELL_RPC, transport)
    );
    bind(FullScreenController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(FullScreenController);

    bind<RpcClient<UpdatesRpc>>(UPDATES_SERVICE).toConstantValue(
      createRpcClient(UPDATES_RPC, transport)
    );
    bind(MCP_SERVICE).toConstantValue(createRpcClient(MCP_RPC, transport));
    bind<RpcClient<SkillsRpc>>(SKILLS_SERVICE).toConstantValue(
      createRpcClient(SKILLS_RPC, transport)
    );
    bind(SEARCH_SERVICE).toConstantValue(createRpcClient(SEARCH_RPC, transport));
    bind(NETWORK_SERVICE).toConstantValue(
      createRpcClient(NETWORK_RPC, transport)
    );
    bind<RpcClient<AppDirectoriesRpc>>(APP_DIRECTORIES_SERVICE).toConstantValue(
      createRpcClient(APP_DIRECTORIES_RPC, transport)
    );
    bind(AUXILIARY_GENERATION_SERVICE).toConstantValue(
      createRpcClient(AUXILIARY_GENERATION_RPC, transport)
    );
    bind(BUILTIN_TOOLS_SERVICE).toConstantValue(
      createRpcClient(BUILTIN_TOOLS_RPC, transport)
    );
    bind<RpcClient<NativeDialogsRpc>>(NATIVE_DIALOGS_SERVICE).toConstantValue(
      createRpcClient(NATIVE_DIALOGS_RPC, transport)
    );
    bind(NATIVE_FILES_SERVICE).toConstantValue(
      createRpcClient(NATIVE_FILES_RPC, transport)
    );
    bind(PROMPT_FILES_SERVICE).toConstantValue(
      createRpcClient(PROMPT_FILES_RPC, transport)
    );
    bind(ACP_SESSION_SERVICE).toConstantValue(
      createRpcClient(ACP_SESSION_RPC, transport)
    );
    bind(RemoteCommandContribution).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      RemoteCommandContribution
    );
  });
}
