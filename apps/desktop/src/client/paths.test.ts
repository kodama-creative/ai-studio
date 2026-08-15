import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { NamespacedRpcRequest } from "@/shared/namespaced-rpc";

const REQUESTS: { method: string; params: unknown }[] = [];

await mock.module("@/lib/electrobun", () => ({
  electrobun: {
    rpc: {
      request: {
        rpcNamespaceRequest: (request: NamespacedRpcRequest) => {
          const [path] = request.args as [string];
          if (request.namespace !== "promptFiles") {
            throw new Error(`Unexpected namespace: ${request.namespace}`);
          }
          if (request.method === "readText") {
            REQUESTS.push({ method: "readText", params: { path } });
            return Promise.resolve({
              ok: true as const,
              value: "LOCAL CONTENT",
            });
          }
          if (request.method !== "exists") {
            throw new Error(`Unexpected method: ${request.method}`);
          }
          REQUESTS.push({ method: "exists", params: { path } });
          return Promise.resolve({
            ok: true as const,
            value: true,
          });
        },
      },
    },
  },
}));

const { readTextFile, textFileExists } = await import("./paths");

describe("local prompt files", () => {
  beforeEach(() => {
    REQUESTS.length = 0;
  });

  test("forwards paths without a runtime-selection argument", async () => {
    expect(await readTextFile("/same/path.md")).toBe("LOCAL CONTENT");
    expect(await textFileExists("/local-only.md")).toBe(true);
    expect(REQUESTS).toEqual([
      {
        method: "readText",
        params: { path: "/same/path.md" },
      },
      {
        method: "exists",
        params: { path: "/local-only.md" },
      },
    ]);
  });

});
