import {
  Container,
  type ContainerModule,
  type ServiceIdentifier,
} from "inversify";

type Disposer = () => void | Promise<void>;

/** One explicitly-owned child container for a native desktop window. */
export class DesktopWindowScope {
  private readonly _disposers: Disposer[] = [];
  private readonly _disposedListeners = new Set<() => void>();
  private _disposePromise: Promise<void> | undefined;
  private _disposed = false;

  constructor(
    readonly id: string,
    private readonly _container: Container,
    private readonly _onDisposed: () => void
  ) {}

  /** Bind a window-owned value without decorators or service-location in consumers. */
  bindConstant<T>(token: ServiceIdentifier<T>, value: T): void {
    this._assertOpen();
    this._container.bind(token).toConstantValue(value);
  }

  /** Load one explicit window composition module. */
  load(module: ContainerModule): void {
    this._assertOpen();
    this._container.load(module);
  }

  /** Resolve dependencies only while composing the window object graph. */
  get<T>(token: ServiceIdentifier<T>): T {
    this._assertOpen();
    return this._container.get(token);
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
  private _disposePromise: Promise<void> | undefined;

  /** Bind one process-wide singleton value at the composition root. */
  bindConstant<T>(token: ServiceIdentifier<T>, value: T): void {
    this._assertOpen();
    this._container.bind(token).toConstantValue(value);
  }

  /** Load one explicit process composition module. */
  load(module: ContainerModule): void {
    this._assertOpen();
    this._container.load(module);
  }

  /** Resolve dependencies only while composing a process or window module. */
  get<T>(token: ServiceIdentifier<T>): T {
    this._assertOpen();
    return this._container.get(token);
  }

  /** Create one uniquely-owned window child scope inheriting process services. */
  createWindowScope(id: string): DesktopWindowScope {
    this._assertOpen();
    if (this._windows.has(id)) {
      throw new Error(`Desktop window scope "${id}" already exists.`);
    }
    const child = new Container({ parent: this._container });
    const scope = new DesktopWindowScope(id, child, () => {
      this._windows.delete(id);
    });
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
    try {
      await this._container.unbindAllAsync();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose desktop process scope.");
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
