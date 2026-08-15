import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { HostServices } from "@llm-space/ui/host";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  NamespacedRpcRequest,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
} from "@/shared/namespaced-rpc";
import type { RuntimeId } from "@/shared/runtime";

class ControllableRpc {
  readonly requests: NamespacedRpcRequest[] = [];
  readonly streams: NamespacedRpcStreamSubscribe[] = [];
  readonly unsubscribed: string[] = [];
  private readonly _streamListeners = new Set<
    (event: NamespacedRpcStreamEvent) => void
  >();

  readonly request = {
    rpcNamespaceRequest: (input: NamespacedRpcRequest) => {
      this.requests.push(input);
      return Promise.resolve({ ok: true as const, value: this._value(input) });
    },
  };

  readonly send = {
    rpcNamespaceStreamSubscribe: (input: NamespacedRpcStreamSubscribe) => {
      this.streams.push(input);
    },
    rpcNamespaceStreamUnsubscribe: ({
      subscriptionId,
    }: {
      subscriptionId: string;
    }) => {
      this.unsubscribed.push(subscriptionId);
    },
  };

  addMessageListener(
    message: "rpcNamespaceStreamEvent",
    listener: (event: NamespacedRpcStreamEvent) => void
  ) {
    expect(message).toBe("rpcNamespaceStreamEvent");
    this._streamListeners.add(listener);
  }

  removeMessageListener(
    message: "rpcNamespaceStreamEvent",
    listener: (event: NamespacedRpcStreamEvent) => void
  ) {
    expect(message).toBe("rpcNamespaceStreamEvent");
    this._streamListeners.delete(listener);
  }

  emit(event: NamespacedRpcStreamEvent): void {
    for (const listener of this._streamListeners) listener(event);
  }

  reset(): void {
    this.requests.length = 0;
    this.streams.length = 0;
    this.unsubscribed.length = 0;
    this._streamListeners.clear();
  }

  private _value(input: NamespacedRpcRequest): unknown {
    if (input.namespace === "skills" && input.method === "getSettings") {
      return { discoveryPaths: [{ path: "/remote/skills", hiddenSkills: [] }] };
    }
    if (input.namespace === "search" && input.method === "get") {
      return { provider: "builtin" };
    }
    if (input.namespace === "generator" && input.method === "resolveEnv") {
      return { modelApiKey: "remote-secret", envValues: {} };
    }
    return [];
  }
}

const RPC = new ControllableRpc();
await mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: RPC } }));

const { CommandProvider } = await import("@/commands");
const { DesktopHostProvider } = await import("./host-services");
const { useHostServices } = await import("@llm-space/ui/host");

const LOCAL_RUNTIME: RuntimeId = "local";

function _captureHost(): HostServices {
  let captured: HostServices | null = null;
  function CaptureHost() {
    captured = useHostServices();
    return null;
  }
  renderToStaticMarkup(
    <CommandProvider>
      <DesktopHostProvider>
        <CaptureHost />
      </DesktopHostProvider>
    </CommandProvider>
  );
  if (!captured) throw new Error("Desktop host was not rendered");
  return captured;
}

describe("Desktop runtime-scoped host services", () => {
  beforeEach(() => RPC.reset());

  test("streams stateless text through the auxiliaryGeneration namespace", async () => {
    const generation = _captureHost().auxiliaryGeneration;
    if (!generation) throw new Error("Desktop host did not provide generation");
    const iterator = generation
      .generate({
        systemPrompt: "Write a title",
        messages: [],
        model: { provider: "test", id: "test" },
      })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    const stream = RPC.streams[0];
    expect(stream).toMatchObject({
      namespace: "auxiliaryGeneration",
      method: "generate",
      args: [
        {
          systemPrompt: "Write a title",
          messages: [],
          model: { provider: "test", id: "test" },
        },
      ],
    });
    const event = { type: "text.completed" as const, text: "A useful title" };
    RPC.emit({
      subscriptionId: stream.subscriptionId,
      type: "item",
      item: event,
    });
    expect(await pending).toEqual({ value: event, done: false });
    await iterator.return?.(undefined);
    expect(RPC.unsubscribed).toContain(stream.subscriptionId);
  });

  test("runtime-sensitive host calls use typed namespace arguments", async () => {
    const host = _captureHost();
    if (!host.generator) throw new Error("Generator services are unavailable");
    await host.skills.getSettings({ runtimeId: LOCAL_RUNTIME });
    await host.skills.listAvailable({ runtimeId: LOCAL_RUNTIME });
    await host.skills.listSkills("/remote/skills", {
      runtimeId: LOCAL_RUNTIME,
    });
    await host.mcp.listServers({ runtimeId: LOCAL_RUNTIME });
    await host.generator.getSearchSettings({ runtimeId: LOCAL_RUNTIME });
    await host.generator.resolveEnv("remote-provider", ["REMOTE_SEARCH_KEY"], {
      runtimeId: LOCAL_RUNTIME,
    });

    expect(RPC.requests).toEqual([
      { namespace: "skills", method: "getSettings", args: [LOCAL_RUNTIME] },
      { namespace: "skills", method: "listAvailable", args: [LOCAL_RUNTIME] },
      {
        namespace: "skills",
        method: "list",
        args: [LOCAL_RUNTIME, "/remote/skills"],
      },
      { namespace: "mcp", method: "listServers", args: [LOCAL_RUNTIME] },
      { namespace: "search", method: "get", args: [LOCAL_RUNTIME] },
      {
        namespace: "generator",
        method: "resolveEnv",
        args: [
          LOCAL_RUNTIME,
          { providerId: "remote-provider", envNames: ["REMOTE_SEARCH_KEY"] },
        ],
      },
    ]);
  });
});
