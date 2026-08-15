import type { Studio } from "@llm-space/studio/server";
import type { BrowserWindow } from "electrobun/bun";

import type { AgentProjectView } from "../../shared/agent-project";
import type { Command } from "../../shared/commands";
import type {
  DesktopProcessContainer,
  DesktopWindowScope,
} from "../di/process-container";
import { PROJECT_WINDOW_TOKENS } from "../di/tokens";
import {
  WINDOW_APPLICATION,
  type WindowApplication,
} from "../native/native-window-module";
import { playgroundWindowModule } from "../playgrounds/playground-module";
import type { AgentProject } from "../projects/agent-project";
import {
  projectWindowIdentityModule,
  projectWindowModule,
} from "../projects/project-module";
import type {
  ProjectWindowAdapter,
  ProjectWindowHandle,
} from "../projects/project-window-manager";
import { ProjectWindowStateFile } from "../projects/project-window-state";
import type { MainWindowRPC } from "../rpc";

import { DesktopWindowRuntime } from "./desktop-window-runtime";
import { createAgentProjectWindow, createMainWindow } from "./window";
import type { WindowStateManager } from "./window-state";

export interface DesktopMainWindowHandle {
  readonly window: BrowserWindow;
  readonly rpc: MainWindowRPC;
  activate(): void;
}

/** Create Main and Project native windows around one owned DI scope. */
export class DesktopWindowFactory implements ProjectWindowAdapter {
  private readonly _runtimes = new Map<number, DesktopWindowRuntime>();

  constructor(
    private readonly _process: DesktopProcessContainer,
    private readonly _homePath: string,
    private readonly _windowStates: WindowStateManager
  ) {}

  /** Create the Main window inside the scope allocated by MainWindowManager. */
  async createMain(
    scope: DesktopWindowScope
  ): Promise<DesktopMainWindowHandle> {
    scope.load(playgroundWindowModule());
    const runtime = new DesktopWindowRuntime(scope, "main");
    const window = await createMainWindow({
      rpc: runtime.rpc,
      windowStates: this._windowStates,
      onFullScreenChange: (fullScreen) =>
        scope
          .get<WindowApplication>(WINDOW_APPLICATION)
          .notifyFullScreenChanged(fullScreen),
    });
    this._attach(scope, window, runtime);
    return {
      window,
      rpc: runtime.rpc,
      activate: () => window.activate(),
    };
  }

  /** Create an isolated Project Studio window and own creation-failure cleanup. */
  async create(project: AgentProject): Promise<ProjectWindowHandle> {
    const scope = this._process.createWindowScope(`project:${project.id}`);
    try {
      scope.load(projectWindowModule({ source: project }));
      const studio = scope.own(
        await scope.getAsync<Studio>(PROJECT_WINDOW_TOKENS.studio)
      );
      const projectView: AgentProjectView = {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        agentRoot: project.agentRoot,
        agentId: studio.agent.agentSpecId,
        generationId: studio.agent.sourceRevision,
      };
      scope.load(projectWindowIdentityModule(projectView));
      const closed = new Set<() => void>();
      scope.onDisposed(() => closed.forEach((listener) => listener()));
      const runtime = new DesktopWindowRuntime(scope, "project");
      const stateStore = await ProjectWindowStateFile.load(
        this._homePath,
        project.id
      );
      const window = await createAgentProjectWindow({
        rpc: runtime.rpc,
        project: projectView,
        stateStore,
        windowStates: this._windowStates,
        onFullScreenChange: (fullScreen) =>
          scope
            .get<WindowApplication>(WINDOW_APPLICATION)
            .notifyFullScreenChanged(fullScreen),
      });
      this._attach(scope, window, runtime);
      return {
        activate: () => window.activate(),
        close: () => scope.dispose(),
        onClosed: (listener) => closed.add(listener),
      };
    } catch (error) {
      try {
        await scope.dispose();
      } catch (cleanupError) {
        console.error(
          "Failed to dispose Agent Project scope after creation failed:",
          cleanupError
        );
      }
      throw error;
    }
  }

  /** Route a native menu command to the Registry owned by its window. */
  executeCommand(command: Command, window: BrowserWindow): void {
    const runtime = this._runtimes.get(window.id);
    if (runtime === undefined) {
      throw new Error(
        `DesktopWindowRuntime is unavailable for window ${window.id}.`
      );
    }
    runtime.execute(command);
  }

  private _attach(
    scope: DesktopWindowScope,
    window: BrowserWindow,
    runtime: DesktopWindowRuntime
  ): void {
    runtime.attach(window);
    this._runtimes.set(window.id, runtime);
    scope.onDisposed(() => this._runtimes.delete(window.id));
  }
}
