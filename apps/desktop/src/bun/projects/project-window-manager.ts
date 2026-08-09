import type { AgentProject } from "./agent-project";
import { openAgentProject } from "./agent-project";

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

export interface ProjectWindowManagerOptions {
  readonly windows: ProjectWindowAdapter;
  readonly state?: ProjectWindowStateStore;
}

/** Owns the one-project/one-window invariant for the desktop process. */
export class ProjectWindowManager {
  private readonly _windows = new Map<
    string,
    { readonly project: AgentProject; readonly handle: ProjectWindowHandle }
  >();
  private readonly _opening = new Map<string, Promise<ProjectWindowHandle>>();
  private _closingAll = false;

  constructor(private readonly _options: ProjectWindowManagerOptions) {}

  async openProject(startPath: string): Promise<void> {
    const project = await openAgentProject(startPath);
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
    handle.onClosed?.(() => {
      this._windows.delete(project.rootPath);
      if (!this._closingAll) void this._saveOpenProjects();
    });
    await this._saveOpenProjects();
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
}
