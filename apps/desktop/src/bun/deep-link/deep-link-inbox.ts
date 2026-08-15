import type { Disposable } from "../../shared/disposable";

export interface DeepLinkConnection extends Disposable {
  readonly bufferedUrls: readonly string[];
}

export interface DeepLinkSource {
  connect(handler: (url: string) => void): DeepLinkConnection;
}

/**
 * Buffers platform deep links until the Desktop launch owner is ready, then
 * transfers every live URL to exactly one connected handler.
 */
export class DeepLinkInbox implements DeepLinkSource {
  private readonly _pending: string[] = [];
  private _handler: ((url: string) => void) | undefined;

  /** Accept one platform URL before or after the application connects. */
  accept(url: string): void {
    if (this._handler === undefined) {
      this._pending.push(url);
      return;
    }
    this._handler(url);
  }

  /** Atomically connect the launch owner and transfer buffered URLs to it. */
  connect(handler: (url: string) => void): DeepLinkConnection {
    if (this._handler !== undefined) {
      throw new Error("Desktop deep-link inbox is already connected.");
    }
    this._handler = handler;
    const bufferedUrls = this._pending.splice(0);
    let connected = true;
    return {
      bufferedUrls,
      dispose: () => {
        if (!connected) return;
        connected = false;
        if (this._handler === handler) this._handler = undefined;
      },
    };
  }
}
