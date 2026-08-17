import type { Disposable } from "./disposable";

export type Event<T> = (listener: (event: T) => void) => Disposable;

export interface EmitterOptions {
  readonly onListenerError?: (error: unknown) => void;
}

/** Owns one typed, in-process fact stream without retaining event history. */
export class Emitter<T> implements Disposable {
  private readonly _listeners = new Set<(event: T) => void>();
  private readonly _onListenerError: (error: unknown) => void;
  private _disposed = false;

  constructor(options: EmitterOptions = {}) {
    this._onListenerError =
      options.onListenerError ??
      ((error) => console.error("Event listener failed:", error));
  }

  /** Subscribe to future facts and return an idempotent removal handle. */
  readonly event: Event<T> = (listener) => {
    if (this._disposed) throw new Error("Emitter is disposed.");
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      },
    };
  };

  /** Publish one committed fact to every listener present at dispatch time. */
  fire(event: T): void {
    if (this._disposed) return;
    for (const listener of [...this._listeners]) {
      try {
        listener(event);
      } catch (error) {
        this._onListenerError(error);
      }
    }
  }

  /** Stop publication, clear listeners, and reject future subscriptions. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._listeners.clear();
  }
}
