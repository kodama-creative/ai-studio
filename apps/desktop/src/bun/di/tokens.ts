import type {
  GistThreadReader,
  GistThreadWriter,
} from "@llm-space/core/storage";
import type { McpManager } from "@llm-space/runtime/mcp";
import type { ModelManager } from "@llm-space/runtime/models";
import type { NetworkSettingsManager } from "@llm-space/runtime/network";
import type { SearchSettingsManager } from "@llm-space/runtime/search";
import type { SkillsManager } from "@llm-space/runtime/skills";
import type { Studio } from "@llm-space/studio/server";

import type {
  AgentProjectView,
  DesktopWindowContext,
} from "../../shared/agent-project";
import type { Analytics } from "../analytics";
import type { WindowStateManager } from "../app/window-state";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import type { DesktopHost } from "../host/desktop-host";
import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";
import type { AgentProject } from "../projects/agent-project";
import type { ProjectWindowManager } from "../projects/project-window-manager";
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
  gistReader: desktopToken<GistThreadReader>("process", "gist-reader"),
  homePath: desktopToken<string>("process", "home-path"),
  mcpManager: desktopToken<McpManager>("process", "mcp-manager"),
  modelManager: desktopToken<ModelManager>("process", "model-manager"),
  networkSettings: desktopToken<NetworkSettingsManager>(
    "process",
    "network-settings"
  ),
  playgroundApplication: desktopToken<DesktopPlaygroundApplication>(
    "playground",
    "application"
  ),
  projectWindows: desktopToken<ProjectWindowManager>(
    "process",
    "project-windows"
  ),
  searchSettings: desktopToken<SearchSettingsManager>(
    "process",
    "search-settings"
  ),
  skillsManager: desktopToken<SkillsManager>("process", "skills-manager"),
  updater: desktopToken<UpdaterService>("process", "updater"),
  windowStates: desktopToken<WindowStateManager>("process", "window-states"),
} as const;

/** Services owned by exactly one native window. */
export const WINDOW_TOKENS = {
  context: desktopToken<DesktopWindowContext>("window", "context"),
} as const;

/** Services which exist only inside one Agent Project Studio window. */
export const PROJECT_WINDOW_TOKENS = {
  source: desktopToken<AgentProject>("project-window", "source"),
  project: desktopToken<AgentProjectView>("project-window", "project"),
  studio: desktopToken<Studio>("project-window", "studio"),
} as const;
