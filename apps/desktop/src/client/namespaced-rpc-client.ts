import { electrobun } from "../lib/electrobun";
import type {
  NamespacedRpcRequest,
  NamespacedRpcEvent,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
  RpcClientTransport,
} from "../shared/namespaced-rpc";
import { RpcClientError } from "../shared/rpc-error";
import type { RpcError } from "../shared/rpc-error";

const EVENT_COMPACTION_THRESHOLD = 1024;

/** Electrobun adapter for the shared, strongly typed namespace client proxy. */
export function createElectrobunRpcClientTransport(): RpcClientTransport {
  return {
    request: (input) => _rpc().request.rpcNamespaceRequest(input),
    stream: (input) => _stream(input),
    subscribe: (namespace, event, listener) =>
      _subscribe(namespace, event, listener),
  };
}

function _subscribe(
  namespace: string,
  event: string,
  listener: (payload: unknown) => void
) {
  const rpc = _rpc();
  const handle = (input: NamespacedRpcEvent) => {
    if (input.namespace === namespace && input.event === event) {
      listener(input.payload);
    }
  };
  rpc.addMessageListener("rpcNamespaceEvent", handle);
  return {
    dispose() {
      rpc.removeMessageListener("rpcNamespaceEvent", handle);
    },
  };
}

async function* _stream(
  input: NamespacedRpcRequest & { readonly signal?: AbortSignal }
): AsyncIterable<unknown> {
  const rpc = _rpc();
  const subscriptionId = crypto.randomUUID();
  let items: unknown[] = [];
  let head = 0;
  let wake: (() => void) | undefined;
  let errorMessage: RpcError | undefined;
  let done = false;
  let aborted = input.signal?.aborted ?? false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onEvent = (event: NamespacedRpcStreamEvent) => {
    if (event.subscriptionId !== subscriptionId) return;
    if (event.type === "item") items.push(event.item);
    else if (event.type === "done") done = true;
    else errorMessage = event.error;
    notify();
  };
  const onAbort = () => {
    aborted = true;
    notify();
  };

  rpc.addMessageListener("rpcNamespaceStreamEvent", onEvent);
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (aborted) return;
    const subscribe: NamespacedRpcStreamSubscribe = {
      subscriptionId,
      namespace: input.namespace,
      method: input.method,
      args: input.args,
    };
    rpc.send.rpcNamespaceStreamSubscribe(subscribe);
    while (true) {
      while (head < items.length) {
        const item = items[head];
        items[head] = undefined;
        head += 1;
        yield item;
        if (head === items.length) {
          items.length = 0;
          head = 0;
        } else if (
          head >= EVENT_COMPACTION_THRESHOLD &&
          head * 2 >= items.length
        ) {
          items = items.slice(head);
          head = 0;
        }
      }
      if (errorMessage !== undefined) throw new RpcClientError(errorMessage);
      if (done || aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    rpc.removeMessageListener("rpcNamespaceStreamEvent", onEvent);
    input.signal?.removeEventListener("abort", onAbort);
    rpc.send.rpcNamespaceStreamUnsubscribe({ subscriptionId });
  }
}

function _rpc(): NonNullable<typeof electrobun.rpc> {
  const rpc = electrobun.rpc;
  if (rpc === undefined) throw new Error("Electrobun RPC is not initialized.");
  return rpc;
}
