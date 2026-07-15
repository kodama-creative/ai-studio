import { describe, expect, test } from "bun:test";

import {
  defineMcpClientConnection,
  isMcpClientConnectionDefinition
} from "./mcp";

describe("defineMcpClientConnection", () => {
  test("preserves callbacks without resolving credentials", async () => {
    let callbackCount = 0;
    const definition = defineMcpClientConnection({
      url: "https://example.com/mcp",
      description: "Example project data.",
      auth: ({ connectionName }) => {
        callbackCount += 1;
        return { token: `${connectionName}-token` };
      },
      headers: async ({ connectionName }) => ({
        "X-Connection": connectionName
      }),
      tools: { allow: ["search", "get_item"] }
    });

    expect(isMcpClientConnectionDefinition(definition)).toBe(true);
    expect(definition.transport).toBe("streamableHttp");
    expect(callbackCount).toBe(0);
    expect(
      await definition.auth?.({
        abortSignal: new AbortController().signal,
        connectionName: "project",
        url: definition.url
      })
    ).toEqual({ token: "project-token" });
    expect(callbackCount).toBe(1);
  });

  test("rejects an empty allowlist", () => {
    expect(() =>
      defineMcpClientConnection({
        url: "https://example.com/mcp",
        description: "Example project data.",
        tools: { allow: [] }
      })).toThrow("tools.allow must contain at least one tool name");
  });
});
