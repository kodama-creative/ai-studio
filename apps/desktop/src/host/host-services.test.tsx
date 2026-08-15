import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { HostServices } from "@llm-space/ui/host";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  NamespacedRpcRequest,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
} from "@/shared/namespaced-rpc";

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
      return { discoveryPaths: [{ path: "/local/skills", hiddenSkills: [] }] };
    }
    if (input.namespace === "search" && input.method === "get") {
      return { provider: "builtin" };
    }
    if (input.namespace === "generator" && input.method === "resolveEnv") {
      return { modelApiKey: "local-secret", envValues: {} };
    }
    if (input.namespace === "mcp" && input.method === "callTool") {
      return {
        content: [{ type: "text", text: "tool result" }],
        isError: true,
      };
    }
    if (input.namespace === "builtinTools" && input.method === "call") {
      return {
        content: [{ type: "text", text: "built-in result" }],
      };
    }
    return [];
  }
}

const RPC = new ControllableRpc();
await mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: RPC } }));

const { CommandProvider } = await import("@/commands");
const { DesktopHostProvider } = await import("./host-services");
const { useHostServices } = await import("@llm-space/ui/host");

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

describe("Desktop local host services", () => {
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

  test("host calls omit the removed runtime-selection argument", async () => {
    const host = _captureHost();
    if (!host.generator) throw new Error("Generator services are unavailable");
    await host.skills.getSettings();
    await host.skills.listAvailable();
    await host.skills.listSkills("/local/skills");
    await host.mcp.listServers();
    await host.generator.getSearchSettings();
    await host.generator.resolveEnv("local-provider", ["SEARCH_KEY"]);

    expect(RPC.requests).toEqual([
      { namespace: "skills", method: "getSettings", args: [] },
      { namespace: "skills", method: "listAvailable", args: [] },
      {
        namespace: "skills",
        method: "list",
        args: ["/local/skills"],
      },
      { namespace: "mcp", method: "listServers", args: [] },
      { namespace: "search", method: "get", args: [] },
      {
        namespace: "generator",
        method: "resolveEnv",
        args: [
          { providerId: "local-provider", envNames: ["SEARCH_KEY"] },
        ],
      },
    ]);
  });

  test("injects its MCP namespace client into tool execution", async () => {
    const host = _captureHost();
    const executeTool = host.executeTool;
    if (executeTool === null) throw new Error("Tool execution is unavailable");
    const result = await executeTool(
      {
        type: "mcp",
        name: "mcp__local__lookup",
        description: "Lookup",
        parameters: { type: "object" },
        serverId: "server-local",
        serverName: "local",
        toolName: "lookup",
      },
      { query: "value" },
      { thread: {}, variables: {} }
    );

    expect(RPC.requests).toEqual([
      {
        namespace: "mcp",
        method: "callTool",
        args: [
          {
            serverId: "server-local",
            toolName: "lookup",
            arguments: { query: "value" },
          },
        ],
      },
    ]);
    expect(result).toEqual({
      content: [{ type: "text", text: "tool result" }],
      isError: true,
    });
  });

  test("injects its Built-in Tools namespace client into tool execution", async () => {
    const executeTool = _captureHost().executeTool;
    if (executeTool === null) throw new Error("Tool execution is unavailable");
    const result = await executeTool(
      {
        type: "builtin",
        name: "read",
        description: "Read a file",
        parameters: { type: "object" },
      },
      { path: "/tmp/example.txt" },
      { thread: {}, variables: {} }
    );

    expect(RPC.requests).toEqual([
      {
        namespace: "builtinTools",
        method: "call",
        args: [
          {
            name: "read",
            arguments: { path: "/tmp/example.txt" },
          },
        ],
      },
    ]);
    expect(result).toEqual({
      content: [{ type: "text", text: "built-in result" }],
      isError: false,
    });
  });
});
