import type { Studio } from "@llm-space/studio/server";
import type { BrowserWindow } from "electrobun/bun";

import type { AgentProjectView } from "../../shared/agent-project";
import type { Command } from "../../shared/commands";
import type {
  DesktopProcessContainer,
  DesktopWindowScope,
} from "../di/process-container";
import type { NativeWindowStateBinding } from "../native/native-window-module";
import type { AgentProject } from "../projects/agent-project";
import { PROJECT_STUDIO } from "../projects/project-module";
import type {
  ProjectWindowAdapter,
  ProjectWindowHandle,
} from "../projects/project-window-manager";
import { ProjectWindowStateFile } from "../projects/project-window-state";
import type { MainWindowRPC } from "../rpc";

import {
  type ConfigureDesktopWindowScope,
  DesktopWindowRuntime,
} from "./desktop-window-runtime";
import { createAgentProjectWindow, createMainWindow } from "./window";

export interface DesktopMainWindowHandle {
  readonly window: BrowserWindow;
  readonly rpc: MainWindowRPC;
  activate(): void;
}

/** Bootstrap-owned registrations needed across the staged window lifecycle. */
export interface DesktopWindowScopeComposition {
  configureMainIdentity(scope: DesktopWindowScope): void;
  configureProjectSource(
    scope: DesktopWindowScope,
    project: AgentProject
  ): void;
  configureProjectIdentity(
    scope: DesktopWindowScope,
    projectView: AgentProjectView
  ): void;
  readonly configureRuntime: ConfigureDesktopWindowScope;
}

/** Create Main and Project native windows around one owned DI scope. */
export class DesktopWindowFactory implements ProjectWindowAdapter {
  private readonly _runtimes = new Map<number, DesktopWindowRuntime>();

  constructor(
    private readonly _process: DesktopProcessContainer,
    private readonly _homePath: string,
    private readonly _composition: DesktopWindowScopeComposition
  ) {}

  /** Create the Main window inside the scope allocated by MainWindowManager. */
  async createMain(
    scope: DesktopWindowScope
  ): Promise<DesktopMainWindowHandle> {
    this._composition.configureMainIdentity(scope);
    const runtime = new DesktopWindowRuntime(
      scope,
      "main",
      this._composition.configureRuntime
    );
    const window = await createMainWindow({
      rpc: runtime.rpc,
      onCreated: (created, state) =>
        this._attach(scope, created, state, runtime),
    });
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
      this._composition.configureProjectSource(scope, project);
      const studio = await scope.getAsync<Studio>(PROJECT_STUDIO);
      const projectView: AgentProjectView = {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        agentRoot: project.agentRoot,
        agentId: studio.agent.agentSpecId,
        generationId: studio.agent.sourceRevision,
      };
      this._composition.configureProjectIdentity(scope, projectView);
      const closed = new Set<() => void>();
      scope.onDisposed(() => closed.forEach((listener) => listener()));
      const runtime = new DesktopWindowRuntime(
        scope,
        "project",
        this._composition.configureRuntime
      );
      const stateStore = await ProjectWindowStateFile.load(
        this._homePath,
        project.id
      );
      const window = await createAgentProjectWindow({
        rpc: runtime.rpc,
        project: projectView,
        stateStore,
        onCreated: (created, state) =>
          this._attach(scope, created, state, runtime),
      });
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
    state: NativeWindowStateBinding,
    runtime: DesktopWindowRuntime
  ): void {
    runtime.attach(window, state);
    this._runtimes.set(window.id, runtime);
    scope.onDisposed(() => this._runtimes.delete(window.id));
  }
}
