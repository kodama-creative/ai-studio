import { isDisposable, type Disposable } from "../../shared/disposable";
import type {
  NamespacedRpcEvent,
  NamespacedRpcRequest,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
  RpcNameSet,
} from "../../shared/namespaced-rpc";
import type { RpcError, RpcResult } from "../../shared/rpc-error";
import { RpcDomainError } from "../../shared/rpc-error";

import type { ContributionProvider } from "./contribution-provider";
import type { AnyRpcServer, RpcContribution } from "./rpc-contribution";

interface RegisteredRpcServer {
  readonly namespace: {
    readonly name: string;
    readonly requestNames: RpcNameSet;
    readonly streamNames: RpcNameSet;
    readonly eventNames: RpcNameSet;
  };
  readonly requests: object;
  readonly streams: object;
  readonly eventSource?: {
    subscribe(event: string, listener: (payload: unknown) => void): Disposable;
  };
}

export interface RpcEventSink {
  sendStreamEvent(event: NamespacedRpcStreamEvent): void;
  sendEvent(event: NamespacedRpcEvent): void;
}

type RegistryState = "idle" | "starting" | "started" | "disposed";

/** Window-scoped namespace registry and transport-independent RPC dispatcher. */
export class RpcRegistry implements Disposable {
  private readonly _servers = new Map<string, RegisteredRpcServer>();
  private readonly _subscriptions = new Map<string, AbortController>();
  private readonly _requests = new Map<string, AbortController>();
  private readonly _registrations: Disposable[] = [];
  private _disposePromise: Promise<void> | undefined;
  private _state: RegistryState = "idle";

  constructor(
    private readonly _contributions: ContributionProvider<RpcContribution>,
    private readonly _sink: RpcEventSink
  ) {}

  /** Collect every RPC contribution exactly once, then freeze namespaces. */
  onStart(): void {
    if (this._state !== "idle") {
      throw new Error(`RpcRegistry cannot start from state "${this._state}".`);
    }
    this._state = "starting";
    try {
      for (const contribution of this._contributions.getContributions()) {
        contribution.registerRpc(this);
      }
      this._state = "started";
    } catch (error) {
      // The window scope remains the authoritative cleanup owner and will
      // await this same idempotent Promise. Attach a rejection handler now so
      // an asynchronous rollback failure cannot become an unhandled task while
      // the synchronous startup error propagates to that owner.
      void this.dispose().catch(() => undefined);
      throw error;
    }
  }

  /** Register one typed namespace while contributions are being collected. */
  registerServer(server: AnyRpcServer): Disposable {
    if (this._state !== "starting") {
      throw new Error(
        `RPC namespace "${server.namespace.name}" can only be registered while RpcRegistry is starting.`
      );
    }
    const namespace = server.namespace.name;
    if (this._servers.has(namespace)) {
      throw new Error(`RPC namespace "${namespace}" is already registered.`);
    }
    const eventSubscriptions: Disposable[] = [];
    const registered = server as RegisteredRpcServer;
    _validateServer(registered);
    this._servers.set(namespace, registered);
    const registration: Disposable = {
      dispose: async () => {
        if (this._servers.get(namespace) === server) {
          this._servers.delete(namespace);
        }
        for (const subscription of eventSubscriptions.reverse()) {
          await subscription.dispose();
        }
        if (isDisposable(server)) await server.dispose();
      },
    };
    this._registrations.push(registration);
    if (registered.eventSource !== undefined) {
      for (const event of registered.namespace.eventNames) {
        eventSubscriptions.push(
          registered.eventSource.subscribe(event, (payload) =>
            this._sink.sendEvent({ namespace, event, payload })
          )
        );
      }
    }
    return registration;
  }

  /** Dispatch one request to its owning namespace server. */
  async request(input: NamespacedRpcRequest): Promise<RpcResult<unknown>> {
    const controller =
      input.requestId === undefined ? undefined : new AbortController();
    if (input.requestId !== undefined && controller !== undefined) {
      this.cancelRequest(input.requestId);
      this._requests.set(input.requestId, controller);
    }
    try {
      this._assertStarted();
      const server = this._requireServer(input.namespace);
      if (!server.namespace.requestNames.has(input.method)) {
        throw new Error(
          `RPC request "${input.namespace}.${input.method}" is not declared.`
        );
      }
      const method = _requireMethod(server.requests, input.method, "request");
      return {
        ok: true,
        value: await method(
          ...(controller === undefined
            ? input.args
            : _withSignal(input.args, controller.signal))
        ),
      };
    } catch (error) {
      return { ok: false, error: _rpcError(error) };
    } finally {
      if (
        input.requestId !== undefined &&
        this._requests.get(input.requestId) === controller
      ) {
        this._requests.delete(input.requestId);
      }
    }
  }

  /** Abort one cancellable request without affecting sibling work. */
  cancelRequest(requestId: string): void {
    this._requests.get(requestId)?.abort();
    this._requests.delete(requestId);
  }

  /** Start one stream; items and terminal state are emitted to the renderer. */
  subscribe(input: NamespacedRpcStreamSubscribe): void {
    try {
      this._assertStarted();
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
    } catch (error) {
      this._sink.sendStreamEvent({
        subscriptionId: input.subscriptionId,
        type: "error",
        error: _rpcError(error),
      });
    }
  }

  /** Abort one stream without affecting sibling namespace subscriptions. */
  unsubscribe(subscriptionId: string): void {
    this._subscriptions.get(subscriptionId)?.abort();
    this._subscriptions.delete(subscriptionId);
  }

  /** Stop dispatch, cancel streams, then release registrations in reverse. */
  dispose(): Promise<void> {
    this._disposePromise ??= this._dispose();
    return this._disposePromise;
  }

  /** Run the idempotent asynchronous cleanup behind {@link dispose}. */
  private async _dispose(): Promise<void> {
    this._state = "disposed";
    const errors: unknown[] = [];
    for (const controller of this._subscriptions.values()) controller.abort();
    this._subscriptions.clear();
    for (const controller of this._requests.values()) controller.abort();
    this._requests.clear();
    for (const registration of this._registrations.reverse()) {
      try {
        await registration.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this._registrations.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose RPC Registry.");
    }
  }

  /** Reject transport calls before startup and after window shutdown. */
  private _assertStarted(): void {
    if (this._state !== "started") {
      throw new Error(`RpcRegistry is not running (state: "${this._state}").`);
    }
  }

  /** Consume one application stream and publish its terminal state exactly once. */
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
        this._sink.sendStreamEvent({
          subscriptionId: input.subscriptionId,
          type: "item",
          item,
        });
      }
      if (!controller.signal.aborted) {
        this._sink.sendStreamEvent({
          subscriptionId: input.subscriptionId,
          type: "done",
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this._sink.sendStreamEvent({
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

  /** Resolve one registered namespace or fail at the transport boundary. */
  private _requireServer(namespace: string): RegisteredRpcServer {
    const server = this._servers.get(namespace);
    if (server === undefined) {
      throw new Error(`RPC namespace "${namespace}" is not registered.`);
    }
    return server;
  }
}

function _validateServer(server: RegisteredRpcServer): void {
  for (const method of server.namespace.requestNames) {
    _requireMethod(server.requests, method, "request");
  }
  for (const method of server.namespace.streamNames) {
    _requireMethod(server.streams, method, "stream");
  }
  if (
    server.namespace.eventNames.size > 0 &&
    server.eventSource === undefined
  ) {
    throw new Error(
      `RPC namespace "${server.namespace.name}" declares events but has no event source.`
    );
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
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (_isRecord(error) && error.name === "AbortError")
  ) {
    return { code: "CANCELLED", message: "RPC request was cancelled." };
  }
  console.error("Unhandled namespaced RPC error:", error);
  return { code: "INTERNAL", message: "Internal RPC error." };
}
