import { describe, expect, test } from "bun:test";

import { type ProjectMcpConnector, ProjectMcpSession } from "./project-mcp-session";
import { ProjectMcpToolCallRejectedError } from "./project-mcp-tool-call-rejected-error";
import { defineMcpClientConnection } from "../../public/definitions/connections/mcp";

import type { CompiledMcpConnection } from "../../runtime/agent/agent-project-snapshot";

describe("ProjectMcpSession", () => {
  test("resolves credentials on activation and exposes only allowlisted tools", async () => {
    const callbacks: string[] = [];
    const calls: string[] = [];
    const connector: ProjectMcpConnector = async options => {
      expect(options.headers).toEqual({
        Authorization: "Bearer secret-token",
        "X-Project": "weather"
      });
      return {
        async listTools() {
          return [
            {
              name: "forecast",
              description: "Read a forecast",
              inputSchema: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"]
              }
            },
            {
              name: "admin",
              description: "Must stay hidden",
              inputSchema: { type: "object" }
            }
          ];
        },
        async callTool(name) {
          calls.push(name);
          return { contentText: "sunny", isError: false };
        },
        async close() { }
      };
    };
    const connection = _connection({
      auth: async () => {
        callbacks.push("auth");
        return { token: "secret-token" };
      },
      headers: async () => {
        callbacks.push("headers");
        return { "X-Project": "weather" };
      }
    });

    expect(callbacks).toEqual([]);
    const session = await ProjectMcpSession.activate([connection], {
      connector
    });

    expect(callbacks).toEqual(["headers", "auth"]);
    expect(session.tools.map(tool => tool.name)).toEqual([
      "weather__forecast"
    ]);
    expect(session.statuses).toEqual([
      expect.objectContaining({ connectionName: "weather", state: "ready" })
    ]);
    expect(
      await session.callTool("weather__forecast", { city: "Shanghai" })
    ).toEqual({ contentText: "sunny", isError: false });
    expect(calls).toEqual(["forecast"]);
    const invalidInputCall = session.callTool("weather__forecast", { city: 42 });
    await expect(invalidInputCall).rejects.toBeInstanceOf(
      ProjectMcpToolCallRejectedError
    );
    await expect(invalidInputCall).rejects.toThrow(
      'Invalid input for project MCP tool "weather__forecast"'
    );
    expect(calls).toEqual(["forecast"]);
    await session.close();
  });

  test("degrades one connection when an exact allowlisted tool is missing", async () => {
    const session = await ProjectMcpSession.activate([_connection()], {
      connector: async () => ({
        async listTools() {
          return [];
        },
        async callTool() {
          throw new Error("not called");
        },
        async close() { }
      })
    });

    expect(session.tools).toEqual([]);
    expect(session.statuses).toEqual([
      expect.objectContaining({
        connectionName: "weather",
        state: "unavailable",
        missingTools: ["forecast"]
      })
    ]);
  });

  test("re-resolves metadata auth once but never retries tools/call", async () => {
    let authCount = 0;
    let connectionCount = 0;
    let callCount = 0;
    const session = await ProjectMcpSession.activate(
      [
        _connection({
          auth: () => {
            authCount += 1;
            return { token: `token-${authCount}` };
          }
        })
      ],
      {
        connector: async () => {
          connectionCount += 1;
          const connectionAttempt = connectionCount;
          return {
            async listTools() {
              if (connectionAttempt === 1) {
                throw Object.assign(new Error("Unauthorized"), { status: 401 });
              }
              return [
                {
                  name: "forecast",
                  description: "Read a forecast",
                  inputSchema: { type: "object" }
                }
              ];
            },
            async callTool() {
              callCount += 1;
              throw new Error("response interrupted");
            },
            async close() { }
          };
        }
      }
    );

    expect(authCount).toBe(2);
    expect(connectionCount).toBe(2);
    await expect(session.callTool("weather__forecast", {})).rejects.toThrow(
      "response interrupted"
    );
    expect(callCount).toBe(1);
  });

  test("forwards cancellation to one in-flight tools/call attempt", async () => {
    let observedSignal: AbortSignal | undefined;
    const session = await ProjectMcpSession.activate([_connection()], {
      connector: async () => ({
        async listTools() {
          return [
            {
              name: "forecast",
              description: "Read a forecast",
              inputSchema: { type: "object" }
            }
          ];
        },
        async callTool(_name, _input, signal) {
          observedSignal = signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error(String(signal.reason))
              );
            }, {
              once: true
            });
          });
        },
        async close() { }
      })
    });
    const controller = new AbortController();

    const call = session.callTool(
      "weather__forecast",
      {},
      controller.signal
    );
    controller.abort(new Error("cancelled"));

    await expect(call).rejects.toThrow("cancelled");
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toEqual(new Error("cancelled"));
  });

  test("aborts in-flight tools/call attempts when the session closes", async () => {
    let observedSignal: AbortSignal | undefined;
    const session = await ProjectMcpSession.activate([_connection()], {
      connector: async () => ({
        async listTools() {
          return [
            {
              name: "forecast",
              description: "Read a forecast",
              inputSchema: { type: "object" }
            }
          ];
        },
        async callTool(_name, _input, signal) {
          observedSignal = signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error(String(signal.reason))
              );
            }, {
              once: true
            });
          });
        },
        async close() { }
      })
    });

    const call = session.callTool("weather__forecast", {});
    await session.close();

    await expect(call).rejects.toThrow("session closed");
    expect(observedSignal?.aborted).toBe(true);
  });
});

function _connection(
  overrides: Partial<Parameters<typeof defineMcpClientConnection>[0]> = {}
): CompiledMcpConnection {
  return {
    name: "weather",
    logicalPath: "connections/weather.ts",
    definition: defineMcpClientConnection({
      url: "https://mcp.example.test",
      description: "Weather service",
      tools: { allow: ["forecast"] },
      ...overrides
    })
  };
}
