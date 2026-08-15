import type { Disposable } from "./disposable";
import { RpcClientError, type RpcError, type RpcResult } from "./rpc-error";

/** Methods exposed by one business-owned RPC namespace. */
export interface RpcNamespaceInterface {
  readonly requests: object;
  readonly streams: object;
  readonly events: object;
}

/** Minimal runtime-immutable collection used by namespace manifests. */
export interface RpcNameSet extends Iterable<string> {
  readonly size: number;
  has(value: string): boolean;
}

/** Runtime identity for a compile-time RPC interface. */
export interface RpcNamespace<TInterface extends RpcNamespaceInterface> {
  readonly name: string;
  readonly requestNames: RpcNameSet;
  readonly streamNames: RpcNameSet;
  readonly eventNames: RpcNameSet;
  /** Retain the interface in the namespace type without emitting runtime data. */
  readonly __interface?: TInterface;
}

type RpcMemberManifest<TMembers extends object> = Readonly<
  Record<keyof TMembers & string, true>
>;

/** Define a namespace once beside its shared interface. */
export function defineRpcNamespace<TInterface extends RpcNamespaceInterface>(
  name: string,
  input: {
    readonly requests: RpcMemberManifest<TInterface["requests"]>;
    readonly streams: RpcMemberManifest<TInterface["streams"]>;
    readonly events: RpcMemberManifest<TInterface["events"]>;
  }
): RpcNamespace<TInterface> {
  if (name.trim().length === 0) throw new Error("RPC namespace is required.");
  const requestNames = _manifestNames(name, "request", input.requests);
  const streamNames = _manifestNames(name, "stream", input.streams);
  const eventNames = _manifestNames(name, "event", input.events);
  for (const method of requestNames) {
    if (streamNames.has(method)) {
      throw new Error(
        `RPC method "${name}.${method}" cannot be both a request and a stream.`
      );
    }
  }
  return Object.freeze({
    name,
    requestNames,
    streamNames,
    eventNames,
  });
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
 * Build a strongly typed, immutable client from the namespace manifest.
 * Only declared members exist at runtime, so language protocols such as
 * Promise thenable assimilation and JSON serialization cannot become RPCs.
 */
export function createRpcClient<TInterface extends RpcNamespaceInterface>(
  namespace: RpcNamespace<TInterface>,
  transport: RpcClientTransport
): RpcClient<TInterface> {
  const client = Object.create(null) as RpcClient<TInterface>;
  _defineClientMember(
    client,
    "on",
    (event: string, listener: (payload: unknown) => void) => {
      if (!namespace.eventNames.has(event)) {
        throw new Error(
          `RPC event "${namespace.name}.${event}" is not declared.`
        );
      }
      return transport.subscribe(namespace.name, event, listener);
    }
  );
  for (const method of namespace.requestNames) {
    _defineClientMember(client, method, async (...args: readonly unknown[]) => {
      const result = await transport.request({
        namespace: namespace.name,
        method,
        args: _withoutTrailingUndefined(args),
      });
      if (!result.ok) {
        throw new RpcClientError(result.error);
      }
      return result.value;
    });
  }
  for (const method of namespace.streamNames) {
    _defineClientMember(client, method, (...args: readonly unknown[]) => {
      const serializableArgs = args.map(_withoutSignal);
      return transport.stream({
        namespace: namespace.name,
        method,
        args: _withoutTrailingUndefined(serializableArgs),
        signal: _findSignal(args),
      });
    });
  }
  return Object.freeze(client);
}

function _defineClientMember(
  client: object,
  name: string,
  value: unknown
): void {
  Object.defineProperty(client, name, {
    configurable: false,
    enumerable: false,
    value,
    writable: false,
  });
}

const RESERVED_RPC_METHOD_NAMES = new Set([
  "on",
  "then",
  "catch",
  "finally",
  "toJSON",
  ...Object.getOwnPropertyNames(Object.prototype),
]);

function _manifestNames(
  namespace: string,
  kind: "request" | "stream" | "event",
  manifest: object
): RpcNameSet {
  const names = new Set<string>();
  for (const [name, declared] of Object.entries(manifest)) {
    if (declared !== true) {
      throw new Error(
        `RPC ${kind} "${namespace}.${name}" must be declared with true.`
      );
    }
    if (name.trim().length === 0 || name !== name.trim()) {
      throw new Error(`RPC ${kind} name "${name}" is invalid.`);
    }
    if (kind !== "event" && RESERVED_RPC_METHOD_NAMES.has(name)) {
      throw new Error(
        `RPC ${kind} method "${namespace}.${name}" uses reserved client member "${name}".`
      );
    }
    names.add(name);
  }
  return new ImmutableNameSet(names);
}

/** Runtime-immutable ReadonlySet facade for one validated manifest snapshot. */
class ImmutableNameSet implements RpcNameSet {
  readonly #values: Set<string>;

  constructor(values: Iterable<string>) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: string): boolean {
    return this.#values.has(value);
  }

  [Symbol.iterator](): SetIterator<string> {
    return this.#values.values();
  }
}

/** Preserve omitted optional arguments across JSON transports. */
function _withoutTrailingUndefined(
  args: readonly unknown[]
): readonly unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end -= 1;
  return end === args.length ? args : args.slice(0, end);
}

function _withoutSignal(input: unknown): unknown {
  if (!_isRecord(input) || !(input.signal instanceof AbortSignal)) return input;
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
