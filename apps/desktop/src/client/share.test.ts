import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { PortableThreadSnapshot } from "@llm-space/core";

import type { NamespacedRpcRequest } from "@/shared/namespaced-rpc";

const REQUESTS: NamespacedRpcRequest[] = [];
const SNAPSHOT: PortableThreadSnapshot = {
  kind: "llm-space.thread-snapshot",
  schemaVersion: 1,
  source: {
    product: "playground",
    productId: "playground-1",
    sessionId: "session-1",
    lane: "main",
    leafId: "leaf-1",
  },
  thread: { title: "Local title", context: { messages: [] } },
};

const RPC = {
  request: {
    rpcNamespaceRequest: (request: NamespacedRpcRequest) => {
      REQUESTS.push(request);
      if (request.method === "read") {
        return Promise.resolve({ ok: true as const, value: SNAPSHOT });
      }
      return Promise.resolve({
        ok: true as const,
        value: {
          shareUrl: "https://example.test/shared",
          gistId: "gist-1",
        },
      });
    },
  },
};

await mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: RPC } }));

const { createThreadSharingClient } = await import("./share");

describe("Playground snapshot sharing client", () => {
  beforeEach(() => {
    REQUESTS.length = 0;
  });

  test("reads the selected Playground lane/leaf snapshot", async () => {
    const client = createThreadSharingClient();
    expect(await client.read("playground-1")).toEqual(SNAPSHOT);
    expect(REQUESTS).toEqual([
      {
        namespace: "threadSharing",
        method: "read",
        args: ["playground-1"],
      },
    ]);
  });

  test("publishes the Playground by product identity", async () => {
    const client = createThreadSharingClient();
    await client.publish("playground-1", {
      title: "Shared title",
      description: "Description",
    });
    expect(REQUESTS).toEqual([
      {
        namespace: "threadSharing",
        method: "publish",
        args: [
          "playground-1",
          { title: "Shared title", description: "Description" },
        ],
      },
    ]);
  });
});
