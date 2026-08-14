import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { AgentEvent, AgentStreamRequest } from "@llm-space/core";
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

const REMOTE_RUNTIME: RuntimeId = "remote:auxiliary-generation";
const REQUEST: AgentStreamRequest = {
  model: { provider: "test", id: "test" },
  context: { messages: [], tools: [], responseApiNativeTools: [] },
};

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

  test("streams through the agentExecution namespace with its Runtime owner", async () => {
    const transport = _captureHost().createTransport(REMOTE_RUNTIME);
    if (!transport) throw new Error("Desktop host did not provide transport");
    const iterator = transport(REQUEST, {})[Symbol.asyncIterator]();
    const pending = iterator.next();
    const stream = RPC.streams[0];
    expect(stream).toMatchObject({
      namespace: "agentExecution",
      method: "stream",
      args: [REMOTE_RUNTIME, REQUEST, { connection: undefined }],
    });
    const event: AgentEvent = { type: "agent_start" };
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
    await host.skills.getSettings({ runtimeId: REMOTE_RUNTIME });
    await host.skills.listAvailable({ runtimeId: REMOTE_RUNTIME });
    await host.skills.listSkills("/remote/skills", {
      runtimeId: REMOTE_RUNTIME,
    });
    await host.mcp.listServers({ runtimeId: REMOTE_RUNTIME });
    await host.generator.getSearchSettings({ runtimeId: REMOTE_RUNTIME });
    await host.generator.resolveEnv("remote-provider", ["REMOTE_SEARCH_KEY"], {
      runtimeId: REMOTE_RUNTIME,
    });

    expect(RPC.requests).toEqual([
      { namespace: "skills", method: "getSettings", args: [REMOTE_RUNTIME] },
      { namespace: "skills", method: "listAvailable", args: [REMOTE_RUNTIME] },
      {
        namespace: "skills",
        method: "list",
        args: [REMOTE_RUNTIME, "/remote/skills"],
      },
      { namespace: "mcp", method: "listServers", args: [REMOTE_RUNTIME] },
      { namespace: "search", method: "get", args: [REMOTE_RUNTIME] },
      {
        namespace: "generator",
        method: "resolveEnv",
        args: [
          REMOTE_RUNTIME,
          { providerId: "remote-provider", envNames: ["REMOTE_SEARCH_KEY"] },
        ],
      },
    ]);
  });
});
