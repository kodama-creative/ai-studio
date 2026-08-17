import type { Disposable } from "./disposable";
import { Emitter } from "./event";

/** Process-local typed event fan-out with no replay or retained history. */
export class EventHub<TEvents extends object> implements Disposable {
  private readonly _emitters = new Map<keyof TEvents, Emitter<never>>();
  private readonly _onListenerError: (error: unknown) => void;
  private _disposed = false;

  constructor(
    onListenerError: (error: unknown) => void = (error) =>
      console.error("Event listener failed:", error)
  ) {
    this._onListenerError = onListenerError;
  }

  /** Broadcast a transient value to the listeners currently attached. */
  publish<TKey extends keyof TEvents>(
    event: TKey,
    payload: TEvents[TKey]
  ): void {
    if (this._disposed) return;
    this._emitters.get(event)?.fire(payload as never);
  }

  /** Subscribe without replay; disposing the handle removes only this listener. */
  subscribe<TKey extends keyof TEvents>(
    event: TKey,
    listener: (payload: TEvents[TKey]) => void
  ): Disposable {
    if (this._disposed) throw new Error("EventHub is disposed.");
    let emitter = this._emitters.get(event);
    if (emitter === undefined) {
      emitter = new Emitter<never>({
        onListenerError: this._onListenerError,
      });
      this._emitters.set(event, emitter);
    }
    return emitter.event(listener);
  }

  /** Release every listener and reject future subscriptions. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const emitter of this._emitters.values()) emitter.dispose();
    this._emitters.clear();
  }
}
