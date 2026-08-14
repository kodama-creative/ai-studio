import type { AgentApp, AnyWireMessage, AgentConnection } from "@llm-space/acp";

import { ACP_RPC, type AcpRpc } from "../../shared/acp-rpc";
import type { Disposable } from "../../shared/disposable";
import type { RpcServer } from "../../shared/namespaced-rpc";

interface AcpConnectionState {
  readonly incoming: WritableStreamDefaultWriter<AnyWireMessage>;
  readonly outgoing: ReadableStreamDefaultReader<AnyWireMessage>;
  readonly connection: AgentConnection;
}

/** Bridges official ACP wire messages over the generic Electrobun envelope. */
export class AcpRpcServer implements RpcServer<AcpRpc>, Disposable {
  readonly namespace = ACP_RPC;
  readonly requests = {
    open: (connectionId: string) => this._open(connectionId),
    send: (connectionId: string, message: AnyWireMessage) =>
      this._send(connectionId, message),
    close: (connectionId: string) => this._close(connectionId),
  };
  readonly streams = {
    receive: (
      connectionId: string,
      options: { readonly signal?: AbortSignal } = {}
    ) => this._receive(connectionId, options.signal),
  };
  private readonly _connections = new Map<string, AcpConnectionState>();

  constructor(private readonly _app: AgentApp) {}

  /** Creates one official ACP connection before either direction starts I/O. */
  private _open(connectionId: string): Promise<void> {
    if (this._connections.has(connectionId)) {
      throw new Error(`ACP connection "${connectionId}" is already open.`);
    }
    const incoming = new TransformStream<AnyWireMessage, AnyWireMessage>();
    const outgoing = new TransformStream<AnyWireMessage, AnyWireMessage>();
    const connection = this._app.connect({
      writable: outgoing.writable,
      readable: incoming.readable,
    });
    const state: AcpConnectionState = {
      incoming: incoming.writable.getWriter(),
      outgoing: outgoing.readable.getReader(),
      connection,
    };
    this._connections.set(connectionId, state);
    void connection.closed.finally(() => {
      if (this._connections.get(connectionId) === state) {
        this._connections.delete(connectionId);
      }
    });
    return Promise.resolve();
  }

  /** Writes one JSON-RPC message without interpreting or flattening ACP methods. */
  private async _send(
    connectionId: string,
    message: AnyWireMessage
  ): Promise<void> {
    await this._require(connectionId).incoming.write(message);
  }

  /** Streams agent-side ACP output until transport or window cancellation. */
  private async *_receive(
    connectionId: string,
    signal: AbortSignal | undefined
  ): AsyncIterable<AnyWireMessage> {
    const state = this._require(connectionId);
    const abort = () => state.connection.close(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (!signal?.aborted) {
        const result = await state.outgoing.read();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      await this._close(connectionId);
    }
  }

  /** Closes one ACP connection and both custom transport directions. */
  private async _close(connectionId: string): Promise<void> {
    const state = this._connections.get(connectionId);
    if (state === undefined) return;
    this._connections.delete(connectionId);
    state.connection.close();
    await Promise.allSettled([
      state.incoming.close(),
      state.outgoing.cancel(),
      state.connection.closed,
    ]);
  }

  /** Resolves an opened connection or rejects stale renderer traffic. */
  private _require(connectionId: string): AcpConnectionState {
    const state = this._connections.get(connectionId);
    if (state === undefined) {
      throw new Error(`ACP connection "${connectionId}" is not open.`);
    }
    return state;
  }

  /** Releases every window-scoped ACP connection during RPC teardown. */
  async dispose(): Promise<void> {
    await Promise.all(
      [...this._connections.keys()].map((id) => this._close(id))
    );
  }
}
