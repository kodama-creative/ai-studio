import { inject, injectable, preDestroy } from "inversify";

import { Emitter, type Event } from "../../shared/event";
import { WINDOW_CONTAINER_FACTORY } from "../app/window-container-factory";

import { AgentProjectLoader, type AgentProject } from "./agent-project";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
} from "./project-window-state";

export interface ProjectWindowHandle {
  readonly onDidClose: Event<void>;
  activate(): void;
  close(): Promise<void> | void;
}

export interface ProjectWindowAdapter {
  create(project: AgentProject): Promise<ProjectWindowHandle>;
}

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
  private readonly _opening = new Map<string, Promise<void>>();
  private _catalogMutation = Promise.resolve();
  private _stateMutation = Promise.resolve();
  private _closingAll = false;
  private _closePromise: Promise<void> | undefined;

  constructor(
    @inject(WINDOW_CONTAINER_FACTORY)
    private readonly _windowsAdapter: ProjectWindowAdapter,
    @inject(FileProjectWindowStateStore)
    private readonly _state: FileProjectWindowStateStore,
    @inject(FileAgentProjectCatalogStore)
    private readonly _catalog: FileAgentProjectCatalogStore,
    @inject(AgentProjectLoader)
    private readonly _loader: AgentProjectLoader
  ) {}

  async openProject(startPath: string): Promise<void> {
    if (this._closingAll) {
      throw new Error("Project windows are shutting down.");
    }
    const project = await this._loader.open(startPath);
    // A deep link may have entered before shutdown and finished source loading
    // after closeAll began. It must not create a child of a disposing parent.
    if (this._closingAll) return;
    const existing = this._windows.get(project.rootPath);
    if (existing !== undefined) {
      existing.handle.activate();
      return;
    }
    const opening = this._opening.get(project.rootPath);
    if (opening !== undefined) {
      await opening;
      this._windows.get(project.rootPath)?.handle.activate();
      return;
    }
    const createWindow = this._openWindow(project);
    this._opening.set(project.rootPath, createWindow);
    try {
      await createWindow;
    } finally {
      if (this._opening.get(project.rootPath) === createWindow) {
        this._opening.delete(project.rootPath);
      }
    }
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
      if (this._closingAll) break;
      try {
        await this.openProject(path);
      } catch (error) {
        console.error(`Failed to restore agent project "${path}":`, error);
      }
    }
  }

  /** Close every Project window without erasing the next-start restore set. */
  @preDestroy()
  closeAll(): Promise<void> {
    return (this._closePromise ??= this._closeAll());
  }

  private async _closeAll(): Promise<void> {
    this._closingAll = true;
    const errors: unknown[] = [];
    const openings = await Promise.allSettled([...this._opening.values()]);
    for (const result of openings) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    // Natural native closes persist in the background; drain their serialized
    // writes before the process releases this manager.
    await this._stateMutation;
    const closes = await Promise.allSettled(
      [...this._windows.values()].map(({ handle }) =>
        Promise.resolve(handle.close())
      )
    );
    for (const result of closes) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    this._windows.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close Project windows.");
    }
  }

  /** Create and adopt one window, or close it immediately if shutdown won. */
  private async _openWindow(project: AgentProject): Promise<void> {
    const handle = await this._windowsAdapter.create(project);
    if (this._closingAll) {
      await handle.close();
      return;
    }
    this._windows.set(project.rootPath, { project, handle });
    handle.onDidClose(() => {
      this._windows.delete(project.rootPath);
      if (!this._closingAll) {
        void this._saveOpenProjects().catch((error) => {
          console.error("Failed to persist open Project windows:", error);
        });
      }
    });
    await this._rememberProject(project.rootPath);
    await this._saveOpenProjects();
  }

  private _saveOpenProjects(): Promise<void> {
    const roots = [...this._windows.keys()].sort((left, right) =>
      left.localeCompare(right)
    );
    const mutation = this._stateMutation.then(() => this._state.save(roots));
    this._stateMutation = mutation.catch(() => undefined);
    return mutation;
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
