import type { GistThreadWriter } from "@llm-space/core/storage";
import type { PluginManager } from "@llm-space/runtime/plugins";
import type { Studio } from "@llm-space/studio/server";
import type { BrowserWindow } from "electrobun/bun";

import type {
  AgentProjectView,
  DesktopWindowContext,
} from "../../shared/agent-project";
import type { Analytics } from "../analytics";
import type { WindowStateManager } from "../app/window-state";
import type { GitHubAuthManager } from "../auth";
import type { DesktopHost } from "../host/desktop-host";
import type { McpManager } from "../mcp";
import type { ModelManager } from "../models";
import type { NetworkSettingsManager } from "../network";
import type { PlaygroundHost } from "../playgrounds/playground-host";
import type { PluginCommandExecutionController } from "../plugins/plugin-command-execution-controller";
import type { ProjectWindowManager } from "../projects/project-window-manager";
import type { RemoteServerManager } from "../remote";
import type { MainWindowRPC } from "../rpc";
import type { RuntimeRouter } from "../runtime";
import type { SearchSettingsManager } from "../search";
import type { SkillsManager } from "../skills";
import type { StreamThreadController } from "../streaming";
import type { TraceManager } from "../traces";
import type { UpdaterService } from "../updates";

export type DesktopToken<T> = symbol & { readonly __service?: T };

function _token<T>(name: string): DesktopToken<T> {
  return Symbol.for(`@llm-space/desktop/${name}`);
}

/** Process-scoped services shared by Main and every Project Studio window. */
export const PROCESS_TOKENS = {
  analytics: _token<Analytics>("process/analytics"),
  desktopHost: _token<DesktopHost>("process/desktop-host"),
  githubAuth: _token<GitHubAuthManager>("process/github-auth"),
  gistWriter: _token<GistThreadWriter>("process/gist-writer"),
  homePath: _token<string>("process/home-path"),
  mcpManager: _token<McpManager>("process/mcp-manager"),
  modelManager: _token<ModelManager>("process/model-manager"),
  networkSettings: _token<NetworkSettingsManager>("process/network-settings"),
  playgroundHost: _token<PlaygroundHost>("process/playground-host"),
  pluginManager: _token<PluginManager>("process/plugin-manager"),
  pluginCommandExecutions:
    _token<PluginCommandExecutionController>("process/plugin-commands"),
  projectWindows: _token<ProjectWindowManager>("process/project-windows"),
  remoteServerManager:
    _token<RemoteServerManager>("process/remote-server-manager"),
  runtimeRouter: _token<RuntimeRouter>("process/runtime-router"),
  searchSettings: _token<SearchSettingsManager>("process/search-settings"),
  skillsManager: _token<SkillsManager>("process/skills-manager"),
  streaming: _token<StreamThreadController>("process/streaming"),
  traceManager: _token<TraceManager>("process/trace-manager"),
  updater: _token<UpdaterService>("process/updater"),
  windowStates: _token<WindowStateManager>("process/window-states"),
} as const;

/** Services owned by exactly one native window. */
export const WINDOW_TOKENS = {
  browserWindow: _token<BrowserWindow>("window/browser-window"),
  context: _token<DesktopWindowContext>("window/context"),
  rpc: _token<MainWindowRPC>("window/rpc"),
} as const;

/** Services which exist only inside one Agent Project Studio window. */
export const PROJECT_WINDOW_TOKENS = {
  project: _token<AgentProjectView>("project-window/project"),
  studio: _token<Studio>("project-window/studio"),
} as const;
