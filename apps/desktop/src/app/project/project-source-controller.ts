import type {
  ProjectSourceNode,
  ProjectSourceSnapshot,
  ProjectStudioTransport,
} from "@/shared/project-studio";

export interface ProjectSourceControllerSnapshot {
  readonly files: readonly ProjectSourceNode[];
  readonly revision?: string;
  readonly contentByPath: ReadonlyMap<string, string>;
  readonly loading: boolean;
}

export interface ProjectSourceControllerOptions {
  readonly client: Pick<
    ProjectStudioTransport,
    "readSourceFile" | "watchSourceFiles"
  >;
  readonly reportError: (title: string, error: unknown) => void;
}

type Listener = () => void;

/**
 * Owns the Project source snapshot, open-file cache, and source watch lifecycle.
 *
 * The source stream is authoritative and emits its initial tree. Callers only
 * express which files are open; the controller keeps those documents current.
 */
export class ProjectSourceController {
  private readonly _listeners = new Set<Listener>();
  private readonly _pendingReads = new Map<string, Promise<boolean>>();
  private _lifecycle = 0;
  private _started = false;
  private _subscription?: AbortController;
  private _snapshot: ProjectSourceControllerSnapshot = {
    files: [],
    contentByPath: new Map(),
    loading: true,
  };

  constructor(private readonly _options: ProjectSourceControllerOptions) {}

  readonly getSnapshot = (): ProjectSourceControllerSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Start or restart the source watch. The stream supplies the initial tree. */
  start(): void {
    this.stop();
    this._started = true;
    const lifecycle = ++this._lifecycle;
    const controller = new AbortController();
    this._subscription = controller;
    this._setSnapshot({ ...this._snapshot, loading: true });
    void this._watch(lifecycle, controller);
  }

  /** Stop the source watch and invalidate reads from the previous lifecycle. */
  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    this._subscription?.abort();
    this._subscription = undefined;
    this._pendingReads.clear();
  }

  /** Ensure one source document is loaded and kept current by future events. */
  open(path: string): Promise<boolean> {
    this._requireStarted();
    if (this._snapshot.contentByPath.has(path)) return Promise.resolve(true);
    const pending = this._pendingReads.get(path);
    if (pending !== undefined) return pending;
    const lifecycle = this._lifecycle;
    const read = this._readOpenFile(path, lifecycle);
    this._pendingReads.set(path, read);
    void read.finally(() => {
      if (this._pendingReads.get(path) === read) {
        this._pendingReads.delete(path);
      }
    });
    return read;
  }

  /** Stop retaining and refreshing a document after its code tab closes. */
  close(path: string): void {
    if (!this._snapshot.contentByPath.has(path)) return;
    const contentByPath = new Map(this._snapshot.contentByPath);
    contentByPath.delete(path);
    this._setSnapshot({ ...this._snapshot, contentByPath });
  }

  private async _watch(
    lifecycle: number,
    controller: AbortController
  ): Promise<void> {
    try {
      for await (const source of this._options.client.watchSourceFiles({
        signal: controller.signal,
      })) {
        if (!this._isCurrent(lifecycle)) return;
        await this._acceptSourceSnapshot(source, lifecycle);
      }
    } catch (error) {
      if (!controller.signal.aborted && this._isCurrent(lifecycle)) {
        this._options.reportError("Project source watch failed", error);
      }
    } finally {
      if (this._isCurrent(lifecycle)) {
        this._setSnapshot({ ...this._snapshot, loading: false });
      }
    }
  }

  private async _acceptSourceSnapshot(
    source: ProjectSourceSnapshot,
    lifecycle: number
  ): Promise<void> {
    this._setSnapshot({
      ...this._snapshot,
      files: source.files,
      revision: source.revision,
      loading: false,
    });
    const paths = [...this._snapshot.contentByPath.keys()];
    const refreshed = await Promise.all(
      paths.map(async (path) => {
        try {
          return [
            path,
            await this._options.client.readSourceFile(path),
          ] as const;
        } catch {
          return undefined;
        }
      })
    );
    if (!this._isCurrent(lifecycle)) return;
    const contentByPath = new Map(this._snapshot.contentByPath);
    for (const item of refreshed) {
      if (item !== undefined && contentByPath.has(item[0])) {
        contentByPath.set(item[0], item[1]);
      }
    }
    if (refreshed.some((item) => item !== undefined)) {
      this._setSnapshot({ ...this._snapshot, contentByPath });
    }
  }

  private async _readOpenFile(
    path: string,
    lifecycle: number
  ): Promise<boolean> {
    try {
      const content = await this._options.client.readSourceFile(path);
      if (!this._isCurrent(lifecycle)) return false;
      this._setSnapshot({
        ...this._snapshot,
        contentByPath: new Map(this._snapshot.contentByPath).set(path, content),
      });
      return true;
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._options.reportError("Unable to open source file", error);
      }
      return false;
    }
  }

  private _setSnapshot(snapshot: ProjectSourceControllerSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("ProjectSourceController must be started first.");
    }
  }
}
