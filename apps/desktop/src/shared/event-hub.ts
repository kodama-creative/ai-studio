import type { Disposable } from "./disposable";

/** Process-local typed event fan-out with no replay or retained history. */
export class EventHub<TEvents extends object> implements Disposable {
  private readonly _listeners = new Map<
    keyof TEvents,
    Set<(value: never) => void>
  >();
  private _disposed = false;

  /** Broadcast a transient value to the listeners currently attached. */
  publish<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    if (this._disposed) return;
    for (const listener of this._listeners.get(event) ?? []) {
      listener(payload as never);
    }
  }

  /** Subscribe without replay; disposing the handle removes only this listener. */
  subscribe<TKey extends keyof TEvents>(
    event: TKey,
    listener: (payload: TEvents[TKey]) => void
  ): Disposable {
    if (this._disposed) throw new Error("EventHub is disposed.");
    let listeners = this._listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this._listeners.set(event, listeners);
    }
    listeners.add(listener);
    return {
      dispose: () => {
        listeners.delete(listener);
        if (listeners.size === 0) this._listeners.delete(event);
      },
    };
  }

  /** Release every listener and reject future subscriptions. */
  dispose(): void {
    this._disposed = true;
    this._listeners.clear();
  }
}
