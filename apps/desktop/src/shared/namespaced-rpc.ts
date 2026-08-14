import type { Disposable } from "./disposable";
import { RpcClientError, type RpcError, type RpcResult } from "./rpc-error";

/** Methods exposed by one business-owned RPC namespace. */
export interface RpcNamespaceInterface {
  readonly requests: object;
  readonly streams: object;
  readonly events: object;
}

/** Runtime identity for a compile-time RPC interface. */
export interface RpcNamespace<TInterface extends RpcNamespaceInterface> {
  readonly name: string;
  readonly streamNames: ReadonlySet<string>;
  readonly eventNames: ReadonlySet<string>;
  /** Retain the interface in the namespace type without emitting runtime data. */
  readonly __interface?: TInterface;
}

/** Define a namespace once beside its shared interface. */
export function defineRpcNamespace<TInterface extends RpcNamespaceInterface>(
  name: string,
  input: {
    readonly streams: readonly (keyof TInterface["streams"] & string)[];
    readonly events: readonly (keyof TInterface["events"] & string)[];
  }
): RpcNamespace<TInterface> {
  if (name.trim().length === 0) throw new Error("RPC namespace is required.");
  return {
    name,
    streamNames: new Set(input.streams),
    eventNames: new Set(input.events),
  };
}

/** Concrete server modules implement the same interface consumed by clients. */
export interface RpcServer<TInterface extends RpcNamespaceInterface> {
  readonly namespace: RpcNamespace<TInterface>;
  readonly requests: TInterface["requests"];
  readonly streams: TInterface["streams"];
  readonly eventSource?: RpcEventSource<TInterface["events"]>;
}

/** Process-local event source bridged by each registered window server. */
export interface RpcEventSource<TEvents extends object> {
  subscribe<TEvent extends keyof TEvents & string>(
    event: TEvent,
    listener: (payload: TEvents[TEvent]) => void
  ): Disposable;
}

/** Client view: namespace grouping is registration metadata, not call syntax. */
export type RpcClient<TInterface extends RpcNamespaceInterface> = {
  [TMethod in keyof TInterface["requests"]]: TInterface["requests"][TMethod];
} & {
  [TMethod in keyof TInterface["streams"]]: TInterface["streams"][TMethod];
} & {
  on<TEvent extends keyof TInterface["events"] & string>(
    event: TEvent,
    listener: (payload: TInterface["events"][TEvent]) => void
  ): Disposable;
};

export interface RpcClientTransport {
  request(input: NamespacedRpcRequest): Promise<RpcResult<unknown>>;
  stream(input: NamespacedRpcStreamRequest): AsyncIterable<unknown>;
  subscribe(
    namespace: string,
    event: string,
    listener: (payload: unknown) => void
  ): Disposable;
}

export interface NamespacedRpcRequest {
  readonly namespace: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface NamespacedRpcStreamRequest extends NamespacedRpcRequest {
  readonly signal?: AbortSignal;
}

export interface NamespacedRpcStreamSubscribe {
  readonly subscriptionId: string;
  readonly namespace: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface NamespacedRpcStreamUnsubscribe {
  readonly subscriptionId: string;
}

export type NamespacedRpcStreamEvent =
  | {
      readonly subscriptionId: string;
      readonly type: "item";
      readonly item: unknown;
    }
  | { readonly subscriptionId: string; readonly type: "done" }
  | {
      readonly subscriptionId: string;
      readonly type: "error";
      readonly error: RpcError;
    };

export interface NamespacedRpcEvent {
  readonly namespace: string;
  readonly event: string;
  readonly payload: unknown;
}

/**
 * Build a strongly typed client without duplicating a hand-written adapter.
 * The only cast is contained at the transport seam; callers retain the exact
 * request arguments, response types, and stream item types from the interface.
 */
export function createRpcClientProxy<TInterface extends RpcNamespaceInterface>(
  namespace: RpcNamespace<TInterface>,
  transport: RpcClientTransport
): RpcClient<TInterface> {
  return new Proxy(Object.create(null) as RpcClient<TInterface>, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (property === "on") {
        return (event: string, listener: (payload: unknown) => void) => {
          if (!namespace.eventNames.has(event)) {
            throw new Error(
              `RPC event "${namespace.name}.${event}" is not declared.`
            );
          }
          return transport.subscribe(namespace.name, event, listener);
        };
      }
      if (namespace.streamNames.has(property)) {
        return (...args: readonly unknown[]) =>
          transport.stream({
            namespace: namespace.name,
            method: property,
            args: args.map(_withoutSignal),
            signal: _findSignal(args),
          });
      }
      return async (...args: readonly unknown[]) => {
        const result = await transport.request({
          namespace: namespace.name,
          method: property,
          args,
        });
        if (!result.ok) {
          throw new RpcClientError(result.error);
        }
        return result.value;
      };
    },
  });
}

function _withoutSignal(input: unknown): unknown {
  if (!_isRecord(input) || !("signal" in input)) return input;
  const serializable = { ...input };
  delete serializable.signal;
  return serializable;
}

function _findSignal(args: readonly unknown[]): AbortSignal | undefined {
  for (const input of args) {
    if (_isRecord(input) && input.signal instanceof AbortSignal) {
      return input.signal;
    }
  }
  return undefined;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
