import { EventHub } from "../../shared/event-hub";

import type { AgentProject } from "./agent-project";
import { openAgentProject } from "./agent-project";

export interface ProjectWindowManagerEvents {
  catalogChanged: Record<string, never>;
}

export interface ProjectWindowHandle {
  activate(): void;
  close(): Promise<void> | void;
  onClosed?(listener: () => void): void;
}

export interface ProjectWindowAdapter {
  create(project: AgentProject): Promise<ProjectWindowHandle>;
}

export interface ProjectWindowStateStore {
  load(): Promise<readonly string[]>;
  save(rootPaths: readonly string[]): Promise<void>;
}

export interface AgentProjectCatalogStore {
  load(): Promise<readonly string[]>;
  save(rootPaths: readonly string[]): Promise<void>;
}

export interface ProjectWindowManagerOptions {
  readonly windows: ProjectWindowAdapter;
  readonly state?: ProjectWindowStateStore;
  readonly catalog?: AgentProjectCatalogStore;
  readonly openProject?: typeof openAgentProject;
}

/** Owns the one-project/one-window invariant for the desktop process. */
export class ProjectWindowManager {
  /** Process-wide catalog mutations, independent of which adapter opened it. */
  readonly events = new EventHub<ProjectWindowManagerEvents>();

  private readonly _windows = new Map<
    string,
    { readonly project: AgentProject; readonly handle: ProjectWindowHandle }
  >();
  private readonly _opening = new Map<string, Promise<ProjectWindowHandle>>();
  private _catalogMutation = Promise.resolve();
  private _closingAll = false;

  constructor(private readonly _options: ProjectWindowManagerOptions) {}

  async openProject(startPath: string): Promise<void> {
    const project = await (this._options.openProject ?? openAgentProject)(
      startPath
    );
    const existing = this._windows.get(project.rootPath);
    if (existing !== undefined) {
      existing.handle.activate();
      return;
    }
    const opening = this._opening.get(project.rootPath);
    if (opening !== undefined) {
      (await opening).activate();
      return;
    }
    const createWindow = this._options.windows.create(project);
    this._opening.set(project.rootPath, createWindow);
    let handle: ProjectWindowHandle;
    try {
      handle = await createWindow;
    } finally {
      this._opening.delete(project.rootPath);
    }
    this._windows.set(project.rootPath, { project, handle });
    await this._rememberProject(project.rootPath);
    handle.onClosed?.(() => {
      this._windows.delete(project.rootPath);
      if (!this._closingAll) void this._saveOpenProjects();
    });
    await this._saveOpenProjects();
  }

  /** Resolve durable catalog paths into current Project metadata. */
  async listProjects(): Promise<readonly AgentProject[]> {
    const paths = (await this._options.catalog?.load()) ?? [];
    const projects: AgentProject[] = [];
    for (const path of paths) {
      try {
        projects.push(
          await (this._options.openProject ?? openAgentProject)(path)
        );
      } catch (error) {
        console.error(`Failed to load agent project "${path}":`, error);
      }
    }
    return projects.sort((left, right) => left.name.localeCompare(right.name));
  }

  async restoreProjects(): Promise<void> {
    const paths = (await this._options.state?.load()) ?? [];
    for (const path of paths) {
      try {
        await this.openProject(path);
      } catch (error) {
        console.error(`Failed to restore agent project "${path}":`, error);
      }
    }
  }

  async closeAll(): Promise<void> {
    this._closingAll = true;
    await Promise.all(
      [...this._windows.values()].map(({ handle }) =>
        Promise.resolve(handle.close())
      )
    );
    this._windows.clear();
  }

  private _saveOpenProjects(): Promise<void> {
    return (
      this._options.state?.save(
        [...this._windows.keys()].sort((left, right) =>
          left.localeCompare(right)
        )
      ) ?? Promise.resolve()
    );
  }

  private _rememberProject(rootPath: string): Promise<void> {
    const mutation = this._catalogMutation.then(() =>
      this._commitRememberedProject(rootPath)
    );
    this._catalogMutation = mutation.catch(() => undefined);
    return mutation;
  }

  private async _commitRememberedProject(rootPath: string): Promise<void> {
    if (this._options.catalog === undefined) return;
    const paths = new Set(await this._options.catalog.load());
    if (paths.has(rootPath)) return;
    paths.add(rootPath);
    await this._options.catalog.save([...paths].sort());
    this.events.publish("catalogChanged", {});
  }
}
