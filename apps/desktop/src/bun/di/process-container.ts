import {
  Container,
  type ContainerModule,
  type ServiceIdentifier,
} from "inversify";

import { isDisposable, type Disposable } from "../../shared/disposable";

type Disposer = () => void | Promise<void>;

class DisposableTracker {
  private readonly _resources: Disposable[] = [];
  private readonly _seen = new Set<Disposable>();

  /** Adopt a resolved resource once, preserving construction order. */
  track<T>(value: T): T {
    if (isDisposable(value) && !this._seen.has(value)) {
      this._seen.add(value);
      this._resources.push(value);
    }
    return value;
  }

  /** Dispose adopted resources in reverse construction order. */
  async dispose(errors: unknown[]): Promise<void> {
    for (const resource of this._resources.reverse()) {
      try {
        await resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this._resources.length = 0;
    this._seen.clear();
  }
}

/** One explicitly-owned child container for a native desktop window. */
export class DesktopWindowScope {
  private readonly _disposers: Disposer[] = [];
  private readonly _disposables = new DisposableTracker();
  private readonly _disposedListeners = new Set<() => void>();
  private _disposePromise: Promise<void> | undefined;
  private _disposed = false;

  constructor(
    readonly id: string,
    private readonly _container: Container,
    private readonly _trackInherited: <T>(value: T) => T,
    private readonly _onDisposed: () => void
  ) {}

  /** Bind a window-owned value without decorators or service-location in consumers. */
  bindConstant<T>(token: ServiceIdentifier<T>, value: T): void {
    this._assertOpen();
    this._container.bind(token).toConstantValue(value);
    this._disposables.track(value);
  }

  /** Load one explicit window composition module. */
  load(module: ContainerModule): void {
    this._assertOpen();
    this._container.load(module);
  }

  /** Resolve dependencies only while composing the window object graph. */
  get<T>(token: ServiceIdentifier<T>): T {
    this._assertOpen();
    const value = this._container.get(token);
    // A process singleton may be instantiated for the first time while a
    // window contribution resolves it. Keep that resource owned by the
    // process; only bindings declared in the child belong to this window.
    return this._container.isCurrentBound(token)
      ? this._disposables.track(value)
      : this._trackInherited(value);
  }

  /** Resolve one async factory and adopt only window-owned resources. */
  async getAsync<T>(token: ServiceIdentifier<T>): Promise<T> {
    this._assertOpen();
    const value = await this._container.getAsync(token);
    return this._container.isCurrentBound(token)
      ? this._disposables.track(value)
      : this._trackInherited(value);
  }

  /** Resolve every local + inherited contribution in registration order. */
  getAll<T>(token: ServiceIdentifier<T>): T[] {
    this._assertOpen();
    const isWindowOwned = this._container.isCurrentBound(token);
    return this._container
      .getAll(token, { chained: true })
      .map((value) =>
        isWindowOwned
          ? this._disposables.track(value)
          : this._trackInherited(value)
      );
  }

  /** Register explicit async cleanup; callbacks run in reverse ownership order. */
  onDispose(disposer: Disposer): void {
    this._assertOpen();
    this._disposers.push(disposer);
  }

  /** Observe completed disposal; late listeners are replayed immediately. */
  onDisposed(listener: () => void): void {
    if (this._disposed) {
      listener();
      return;
    }
    this._disposedListeners.add(listener);
  }

  /** Whether this scope can no longer accept a live window owner. */
  get isDisposing(): boolean {
    return this._disposePromise !== undefined;
  }

  /** Dispose only this window scope; inherited process services remain alive. */
  dispose(): Promise<void> {
    // Defer execution so a synchronous native close callback cannot re-enter
    // before the idempotent promise has been assigned.
    this._disposePromise ??= Promise.resolve().then(() => this._dispose());
    return this._disposePromise;
  }

  private async _dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const disposer of this._disposers.reverse()) {
      try {
        await disposer();
      } catch (error) {
        errors.push(error);
      }
    }
    await this._disposables.dispose(errors);
    try {
      await this._container.unbindAllAsync();
    } catch (error) {
      errors.push(error);
    } finally {
      this._disposed = true;
      this._onDisposed();
      for (const listener of this._disposedListeners) listener();
      this._disposedListeners.clear();
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to dispose desktop window scope "${this.id}".`
      );
    }
  }

  private _assertOpen(): void {
    if (this._disposePromise !== undefined) {
      throw new Error(`Desktop window scope "${this.id}" is disposed.`);
    }
  }
}

/** Process root for shared services plus explicitly-owned native window scopes. */
export class DesktopProcessContainer {
  private readonly _container = new Container();
  private readonly _windows = new Map<string, DesktopWindowScope>();
  private readonly _disposers: Disposer[] = [];
  private readonly _disposables = new DisposableTracker();
  private _disposePromise: Promise<void> | undefined;

  /** Bind one process-wide singleton value at the composition root. */
  bindConstant<T>(token: ServiceIdentifier<T>, value: T): void {
    this._assertOpen();
    this._container.bind(token).toConstantValue(value);
    this._disposables.track(value);
  }

  /** Load one explicit process composition module. */
  load(module: ContainerModule): void {
    this._assertOpen();
    this._container.load(module);
  }

  /** Resolve dependencies only while composing a process or window module. */
  get<T>(token: ServiceIdentifier<T>): T {
    this._assertOpen();
    return this._disposables.track(this._container.get(token));
  }

  /** Resolve all process contributions and track disposable instances once. */
  getAll<T>(token: ServiceIdentifier<T>): T[] {
    this._assertOpen();
    return this._container
      .getAll(token)
      .map((value) => this._disposables.track(value));
  }

  /** Create one uniquely-owned window child scope inheriting process services. */
  createWindowScope(id: string): DesktopWindowScope {
    this._assertOpen();
    if (this._windows.has(id)) {
      throw new Error(`Desktop window scope "${id}" already exists.`);
    }
    const child = new Container({ parent: this._container });
    const scope = new DesktopWindowScope(
      id,
      child,
      (value) => this._disposables.track(value),
      () => {
        this._windows.delete(id);
      }
    );
    this._windows.set(id, scope);
    return scope;
  }

  /** Register process cleanup after all remaining windows have closed. */
  onDispose(disposer: Disposer): void {
    this._assertOpen();
    this._disposers.push(disposer);
  }

  /** Dispose windows first, then shared process resources in reverse order. */
  dispose(): Promise<void> {
    this._disposePromise ??= Promise.resolve().then(() => this._dispose());
    return this._disposePromise;
  }

  private async _dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const scope of [...this._windows.values()].reverse()) {
      try {
        await scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const disposer of this._disposers.reverse()) {
      try {
        await disposer();
      } catch (error) {
        errors.push(error);
      }
    }
    await this._disposables.dispose(errors);
    try {
      await this._container.unbindAllAsync();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Failed to dispose desktop process scope."
      );
    }
  }

  private _assertOpen(): void {
    if (this._disposePromise !== undefined) {
      throw new Error("Desktop process scope is disposed.");
    }
  }
}

/** Create the process root without import-time singleton state. */
export function createDesktopProcessContainer(): DesktopProcessContainer {
  return new DesktopProcessContainer();
}
