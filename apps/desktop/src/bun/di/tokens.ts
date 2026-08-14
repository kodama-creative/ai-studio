import type { LocalFileSystem } from "@llm-space/core/server";
import type { GistThreadWriter } from "@llm-space/core/storage";
import type { McpManager } from "@llm-space/runtime/mcp";
import type { ModelManager } from "@llm-space/runtime/models";
import type { NetworkSettingsManager } from "@llm-space/runtime/network";
import type { PluginManager } from "@llm-space/runtime/plugins";
import type { RuntimeRouter } from "@llm-space/runtime/runtime";
import type { SearchSettingsManager } from "@llm-space/runtime/search";
import type { SkillsManager } from "@llm-space/runtime/skills";
import type { StreamThreadController } from "@llm-space/runtime/streaming";
import type { Studio } from "@llm-space/studio/server";
import type { BrowserWindow } from "electrobun/bun";

import type {
  AgentProjectView,
  DesktopWindowContext,
} from "../../shared/agent-project";
import type { Analytics } from "../analytics";
import type { WindowStateManager } from "../app/window-state";
import type { DesktopPlaygroundApplication } from "../application/playground-application";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import type { DesktopHost } from "../host/desktop-host";
import type { PlaygroundHost } from "../playgrounds/playground-host";
import type { PluginCommandExecutionController } from "../plugins/plugin-command-execution-controller";
import type { AgentProject } from "../projects/agent-project";
import type { ProjectWindowManager } from "../projects/project-window-manager";
import type { RemoteServerManager } from "../remote";
import type { MainWindowRPC } from "../rpc";
import type { UpdaterService } from "../updates";

export type DesktopToken<T> = symbol & { readonly __service?: T };

/** Create a stable DI symbol owned by one explicit business or lifecycle namespace. */
export function desktopToken<T>(
  namespace: string,
  name: string
): DesktopToken<T> {
  if (namespace.length === 0 || name.length === 0) {
    throw new Error("Desktop token namespace and name are required.");
  }
  return Symbol.for(`@llm-space/desktop/${namespace}/${name}`);
}

/** Process-scoped services shared by Main and every Project Studio window. */
export const PROCESS_TOKENS = {
  analytics: desktopToken<Analytics>("process", "analytics"),
  desktopHost: desktopToken<DesktopHost>("process", "desktop-host"),
  githubAuth: desktopToken<GitHubAuthManager>("process", "github-auth"),
  gistWriter: desktopToken<GistThreadWriter>("process", "gist-writer"),
  homePath: desktopToken<string>("process", "home-path"),
  localFs: desktopToken<LocalFileSystem>("process", "local-filesystem"),
  mcpManager: desktopToken<McpManager>("process", "mcp-manager"),
  modelManager: desktopToken<ModelManager>("process", "model-manager"),
  networkSettings: desktopToken<NetworkSettingsManager>(
    "process",
    "network-settings"
  ),
  playgroundHost: desktopToken<PlaygroundHost>("process", "playground-host"),
  playgroundApplication: desktopToken<DesktopPlaygroundApplication>(
    "process",
    "playground-application"
  ),
  pluginManager: desktopToken<PluginManager>("process", "plugin-manager"),
  pluginCommandExecutions: desktopToken<PluginCommandExecutionController>(
    "process",
    "plugin-commands"
  ),
  projectWindows: desktopToken<ProjectWindowManager>(
    "process",
    "project-windows"
  ),
  remoteServerManager: desktopToken<RemoteServerManager>(
    "process",
    "remote-server-manager"
  ),
  runtimeRouter: desktopToken<RuntimeRouter>("process", "runtime-router"),
  searchSettings: desktopToken<SearchSettingsManager>(
    "process",
    "search-settings"
  ),
  skillsManager: desktopToken<SkillsManager>("process", "skills-manager"),
  streaming: desktopToken<StreamThreadController>("process", "streaming"),
  updater: desktopToken<UpdaterService>("process", "updater"),
  windowStates: desktopToken<WindowStateManager>("process", "window-states"),
} as const;

/** Services owned by exactly one native window. */
export const WINDOW_TOKENS = {
  browserWindow: desktopToken<BrowserWindow>("window", "browser-window"),
  context: desktopToken<DesktopWindowContext>("window", "context"),
  rpc: desktopToken<MainWindowRPC>("window", "rpc"),
} as const;

/** Services which exist only inside one Agent Project Studio window. */
export const PROJECT_WINDOW_TOKENS = {
  source: desktopToken<AgentProject>("project-window", "source"),
  project: desktopToken<AgentProjectView>("project-window", "project"),
  studio: desktopToken<Studio>("project-window", "studio"),
} as const;
