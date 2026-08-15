import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { NamespacedRpcRequest } from "@/shared/namespaced-rpc";

const REQUESTS: NamespacedRpcRequest[] = [];

await mock.module("@/lib/electrobun", () => ({
  electrobun: {
    rpc: {
      request: {
        rpcNamespaceRequest: (request: NamespacedRpcRequest) => {
          REQUESTS.push(request);
          return Promise.resolve({
            ok: true as const,
            value: request.method === "readText" ? "LOCAL CONTENT" : true,
          });
        },
      },
    },
  },
}));

const { createPromptFilesClient } = await import("./prompt-files");

describe("Prompt Files client", () => {
  beforeEach(() => {
    REQUESTS.length = 0;
  });

  test("owns one namespace and forwards paths without host selection", async () => {
    const client = createPromptFilesClient();
    expect(await client.readText("/same/path.md")).toBe("LOCAL CONTENT");
    expect(await client.exists("/local-only.md")).toBe(true);
    expect(REQUESTS).toEqual([
      {
        namespace: "promptFiles",
        method: "readText",
        args: ["/same/path.md"],
      },
      {
        namespace: "promptFiles",
        method: "exists",
        args: ["/local-only.md"],
      },
    ]);
  });
});
