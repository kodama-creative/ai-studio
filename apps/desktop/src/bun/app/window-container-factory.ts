import type { BrowserWindow } from "electrobun/bun";

import type { Event } from "../../shared/event";
import type { AgentProject } from "../projects/agent-project";
import type { ProjectWindowHandle } from "../projects/project-window-manager";
import type { MainWindowRPC } from "../rpc";

export const WINDOW_CONTAINER_FACTORY = Symbol("WindowContainerFactory");

export interface MainWindowContainerHandle {
  readonly window: BrowserWindow;
  readonly rpc: MainWindowRPC;
  readonly onDidClose: Event<void>;
  activate(): void;
  close(): Promise<void>;
}

/** Creates isolated Main and Project child Containers and owns their release. */
export interface WindowContainerFactory {
  createMain(): Promise<MainWindowContainerHandle>;
  create(project: AgentProject): Promise<ProjectWindowHandle>;
}
