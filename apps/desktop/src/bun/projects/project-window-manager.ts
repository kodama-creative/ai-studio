import { inject, injectable } from "inversify";

import { Emitter, type Event } from "../../shared/event";
import { WINDOW_CONTAINER_FACTORY } from "../app/window-container-factory";

import type { AgentProject } from "./agent-project";

export interface ProjectWindowHandle {
  readonly onDidClose: Event<void>;
  activate(): void;
  close(): Promise<void> | void;
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

export interface AgentProjectLoader {
  open(startPath: string): Promise<AgentProject>;
}

export const PROJECT_WINDOW_STATE_STORE = Symbol("ProjectWindowStateStore");
export const AGENT_PROJECT_CATALOG_STORE = Symbol("AgentProjectCatalogStore");
export const AGENT_PROJECT_LOADER = Symbol("AgentProjectLoader");

/** Owns the one-project/one-window invariant for the desktop process. */
@injectable()
export class ProjectWindowManager {
  private readonly _didChange = new Emitter<void>();

  /** Catalog fact emitted after the durable path set commits. */
  readonly onDidChange = this._didChange.event;

  private readonly _windows = new Map<
    string,
    { readonly project: AgentProject; readonly handle: ProjectWindowHandle }
  >();
  private readonly _opening = new Map<string, Promise<ProjectWindowHandle>>();
  private _catalogMutation = Promise.resolve();
  private _closingAll = false;

  constructor(
    @inject(WINDOW_CONTAINER_FACTORY)
    private readonly _windowsAdapter: ProjectWindowAdapter,
    @inject(PROJECT_WINDOW_STATE_STORE)
    private readonly _state: ProjectWindowStateStore,
    @inject(AGENT_PROJECT_CATALOG_STORE)
    private readonly _catalog: AgentProjectCatalogStore,
    @inject(AGENT_PROJECT_LOADER)
    private readonly _loader: AgentProjectLoader
  ) {}

  async openProject(startPath: string): Promise<void> {
    const project = await this._loader.open(startPath);
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
    const createWindow = this._windowsAdapter.create(project);
    this._opening.set(project.rootPath, createWindow);
    let handle: ProjectWindowHandle;
    try {
      handle = await createWindow;
    } finally {
      this._opening.delete(project.rootPath);
    }
    this._windows.set(project.rootPath, { project, handle });
    await this._rememberProject(project.rootPath);
    handle.onDidClose(() => {
      this._windows.delete(project.rootPath);
      if (!this._closingAll) void this._saveOpenProjects();
    });
    await this._saveOpenProjects();
  }

  /** Resolve durable catalog paths into current Project metadata. */
  async listProjects(): Promise<readonly AgentProject[]> {
    const paths = await this._catalog.load();
    const projects: AgentProject[] = [];
    for (const path of paths) {
      try {
        projects.push(await this._loader.open(path));
      } catch (error) {
        console.error(`Failed to load agent project "${path}":`, error);
      }
    }
    return projects.sort((left, right) => left.name.localeCompare(right.name));
  }

  async restoreProjects(): Promise<void> {
    const paths = await this._state.load();
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
    return this._state.save(
      [...this._windows.keys()].sort((left, right) => left.localeCompare(right))
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
    const paths = new Set(await this._catalog.load());
    if (paths.has(rootPath)) return;
    paths.add(rootPath);
    await this._catalog.save([...paths].sort());
    this._didChange.fire();
  }
}
