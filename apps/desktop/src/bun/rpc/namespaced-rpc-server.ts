import {
  RuntimeCapabilityUnavailableError,
  RuntimeNotFoundError,
} from "@llm-space/runtime/runtime";

import type {
  NamespacedRpcRequest,
  NamespacedRpcEvent,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
  RpcNamespaceInterface,
  RpcServer,
} from "../../shared/namespaced-rpc";
import type { RpcError, RpcResult } from "../../shared/rpc-error";
import { RpcDomainError } from "../../shared/rpc-error";

interface AnyRpcServer {
  readonly namespace: {
    readonly name: string;
    readonly streamNames: ReadonlySet<string>;
    readonly eventNames: ReadonlySet<string>;
  };
  readonly requests: object;
  readonly streams: object;
  readonly eventSource?: {
    subscribe(
      event: string,
      listener: (payload: unknown) => void
    ): { dispose(): void | Promise<void> };
  };
}

export interface NamespacedRpcServerOptions {
  readonly sendStreamEvent: (event: NamespacedRpcStreamEvent) => void;
  readonly sendEvent: (event: NamespacedRpcEvent) => void;
}

/**
 * Own namespace dispatch and every stream subscription for one native window.
 * Business modules remain ordinary classes and never depend on Electrobun.
 */
export class NamespacedRpcServer {
  private readonly _servers = new Map<string, AnyRpcServer>();
  private readonly _subscriptions = new Map<string, AbortController>();
  private readonly _eventSubscriptions: {
    dispose(): void | Promise<void>;
  }[] = [];

  constructor(private readonly _options: NamespacedRpcServerOptions) {}

  /** Register one namespace before the window starts serving RPC traffic. */
  register<TInterface extends RpcNamespaceInterface>(
    server: RpcServer<TInterface>
  ): void {
    const namespace = server.namespace.name;
    if (this._servers.has(namespace)) {
      throw new Error(`RPC namespace "${namespace}" is already registered.`);
    }
    this._servers.set(namespace, server);
    const eventSource = server.eventSource as
      | AnyRpcServer["eventSource"]
      | undefined;
    if (eventSource !== undefined) {
      for (const event of server.namespace.eventNames) {
        this._eventSubscriptions.push(
          eventSource.subscribe(event, (payload) =>
            this._options.sendEvent({ namespace, event, payload })
          )
        );
      }
    }
  }

  /** Dispatch one request to its owning server class. */
  async request(input: NamespacedRpcRequest): Promise<RpcResult<unknown>> {
    try {
      const server = this._requireServer(input.namespace);
      const method = _requireMethod(server.requests, input.method, "request");
      return { ok: true, value: await method(...input.args) };
    } catch (error) {
      return { ok: false, error: _rpcError(error) };
    }
  }

  /** Start one stream; items and terminal state are emitted to the webview. */
  subscribe(input: NamespacedRpcStreamSubscribe): void {
    this.unsubscribe(input.subscriptionId);
    const server = this._requireServer(input.namespace);
    if (!server.namespace.streamNames.has(input.method)) {
      throw new Error(
        `RPC stream "${input.namespace}.${input.method}" is not declared.`
      );
    }
    const method = _requireMethod(server.streams, input.method, "stream");
    const controller = new AbortController();
    this._subscriptions.set(input.subscriptionId, controller);
    void this._consume(input, method, controller);
  }

  /** Abort one stream without affecting sibling module subscriptions. */
  unsubscribe(subscriptionId: string): void {
    this._subscriptions.get(subscriptionId)?.abort();
    this._subscriptions.delete(subscriptionId);
  }

  /** Window disposal owns all remaining stream cancellation. */
  async dispose(): Promise<void> {
    for (const controller of this._subscriptions.values()) controller.abort();
    this._subscriptions.clear();
    for (const subscription of this._eventSubscriptions.reverse()) {
      await subscription.dispose();
    }
    this._eventSubscriptions.length = 0;
  }

  private async _consume(
    input: NamespacedRpcStreamSubscribe,
    method: (...args: readonly unknown[]) => unknown,
    controller: AbortController
  ): Promise<void> {
    try {
      const args = _withSignal(input.args, controller.signal);
      const iterable = method(...args);
      if (!_isAsyncIterable(iterable)) {
        throw new Error(
          `RPC stream "${input.namespace}.${input.method}" did not return an AsyncIterable.`
        );
      }
      for await (const item of iterable) {
        if (controller.signal.aborted) return;
        this._options.sendStreamEvent({
          subscriptionId: input.subscriptionId,
          type: "item",
          item,
        });
      }
      if (!controller.signal.aborted) {
        this._options.sendStreamEvent({
          subscriptionId: input.subscriptionId,
          type: "done",
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this._options.sendStreamEvent({
          subscriptionId: input.subscriptionId,
          type: "error",
          error: _rpcError(error),
        });
      }
    } finally {
      if (this._subscriptions.get(input.subscriptionId) === controller) {
        this._subscriptions.delete(input.subscriptionId);
      }
    }
  }

  private _requireServer(namespace: string): AnyRpcServer {
    const server = this._servers.get(namespace);
    if (server === undefined) {
      throw new Error(`RPC namespace "${namespace}" is not registered.`);
    }
    return server;
  }
}

function _requireMethod(
  methods: object,
  method: string,
  kind: "request" | "stream"
): (...args: readonly unknown[]) => unknown {
  const value = (methods as Record<string, unknown>)[method];
  if (typeof value !== "function") {
    throw new Error(`RPC ${kind} method "${method}" is not registered.`);
  }
  return (value as (...args: readonly unknown[]) => unknown).bind(methods);
}

function _withSignal(
  args: readonly unknown[],
  signal: AbortSignal
): readonly unknown[] {
  if (args.length === 0) return [{ signal }];
  const last = args.at(-1);
  if (last === undefined) return [...args.slice(0, -1), { signal }];
  if (!_isRecord(last)) return [...args, { signal }];
  return [...args.slice(0, -1), { ...last, signal }];
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function _isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function _rpcError(error: unknown): RpcError {
  if (error instanceof RpcDomainError) return error.rpcError;
  if (error instanceof RuntimeNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: error.message,
      details: { runtimeId: error.runtimeId },
    };
  }
  if (error instanceof RuntimeCapabilityUnavailableError) {
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: error.message,
      details: {
        runtimeId: error.runtimeId,
        capability: error.capability,
      },
    };
  }
  console.error("Unhandled namespaced RPC error:", error);
  return {
    code: "INTERNAL",
    message: "Internal RPC error.",
  };
}
