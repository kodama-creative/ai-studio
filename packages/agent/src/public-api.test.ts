import { describe, expect, test } from "bun:test";

import { defineChannel, GET, POST, WS } from "./channels";
import {
  defineMcpClientConnection,
  defineOpenAPIConnection,
} from "./connections";
import { defineState } from "./context";
import { defineExtension } from "./extension";
import { defineHook } from "./hooks";
import { defineInstructions } from "./instructions";
import { defineInstrumentation } from "./instrumentation";
import { defineSandbox } from "./sandbox";
import { defineSchedule } from "./schedules";
import { defineSkill } from "./skills";
import {
  defineTool,
  disableTool,
  experimental_workflow,
  isDisabledToolSentinel,
  isExperimentalWorkflowToolDefinition,
  toolOutput,
  toolOutputPart,
  webSearch,
} from "./tools";
import { always, never, once } from "./tools/approval";
import { defineVariable } from "./variables";

import { defineAgent, defineDynamic, defineRemoteAgent } from "./index";

describe("authoring helpers", () => {
  test("preserve authored definitions and stamp framework sentinels", () => {
    const agent = defineAgent({ model: "openai/gpt-5" });
    const tool = defineTool({
      description: "Echo input",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
      },
      execute: ({ value }: { value?: unknown }) => value,
    });
    const dynamic = defineDynamic({ events: { "turn.started": () => tool } });

    expect(agent.model).toBe("openai/gpt-5");
    expect(tool.description).toBe("Echo input");
    expect(dynamic.kind).toBe("llm-space:dynamic");
    expect(disableTool()).toEqual({ kind: "llm-space:disabled-tool" });
    expect(experimental_workflow()).toEqual({
      kind: "llm-space:workflow-tool",
      maxSubagents: 100,
    });
    expect(webSearch({ provider: "exa" })).toEqual({
      kind: "llm-space:web-search-tool",
      provider: "exa",
    });
  });

  test("provides every generic define surface", () => {
    expect(defineInstructions({ markdown: "Be useful" })).toEqual({
      markdown: "Be useful",
    });
    expect(
      defineSkill({ description: "Review", markdown: "Review carefully" })
    ).toEqual({
      description: "Review",
      markdown: "Review carefully",
    });
    const variable = defineVariable({
      name: "skill_catalog",
      resolve: ({ skills }) => skills.map((skill) => skill.name).join(","),
    });
    expect(variable.name).toBe("skill_catalog");
    expect(variable.resolve).toBeFunction();
    expect(
      defineHook({ events: { "turn.started": () => undefined } })
    ).toHaveProperty("events");
    expect(
      defineSchedule({ cron: "0 * * * *", markdown: "Check status" })
    ).toHaveProperty("cron", "0 * * * *");
    expect(defineSandbox({ backend: { kind: "local" } })).toHaveProperty(
      "backend"
    );
    expect(defineInstrumentation({ recordInputs: false })).toEqual({
      recordInputs: false,
    });
    expect(
      defineRemoteAgent({
        url: "https://example.test/agent",
        description: "Remote",
      })
    ).toEqual({
      kind: "remote",
      path: "/llm-space/v1/session",
      url: "https://example.test/agent",
      description: "Remote",
    });
    expect(
      defineChannel({
        routes: [
          GET("/health", () => new Response("ok")),
          POST("/run", () => new Response("accepted")),
        ],
      })
    ).toHaveProperty("routes");
    expect(WS("/events", () => ({ message: () => undefined }))).toMatchObject({
      method: "WEBSOCKET",
      transport: "websocket",
    });
    expect(
      defineMcpClientConnection({
        description: "Example MCP",
        url: "https://mcp.example.test",
      })
    ).toHaveProperty("description", "Example MCP");
    expect(
      defineOpenAPIConnection({
        description: "Example API",
        spec: "https://api.example.test/openapi.json",
      })
    ).toHaveProperty("description", "Example API");
  });

  test("builds approval policies and structured model output", () => {
    const context = {
      approvedTools: new Set<string>(),
      callId: "call-1",
      execution: { threadId: "thread-1", runId: "run-1" },
      toolName: "echo",
    };
    expect(always()(context)).toBe("user-approval");
    expect(never()(context)).toBe("not-applicable");
    expect(once()(context)).toBe("user-approval");
    expect(once()({ ...context, approvedTools: new Set(["echo"]) })).toBe(
      "not-applicable"
    );
    expect(toolOutput.text("done")).toEqual({ type: "text", value: "done" });
    expect(toolOutput.json({ ok: true })).toEqual({
      type: "json",
      value: { ok: true },
    });
    expect(toolOutput.content([toolOutputPart.text("hello")])).toEqual({
      type: "content",
      value: [{ type: "text", text: "hello" }],
    });
    expect(
      toolOutputPart.file("aGVsbG8=", { mediaType: "text/plain" })
    ).toEqual({
      type: "file",
      data: { type: "data", data: "aGVsbG8=" },
      mediaType: "text/plain",
    });
    expect(isDisabledToolSentinel(disableTool())).toBeTrue();
    expect(
      isExperimentalWorkflowToolDefinition(experimental_workflow())
    ).toBeTrue();
  });

  test("state requires an active managed context", () => {
    const state = defineState("example.counter", () => 0);
    expect(() => state.get()).toThrow("active agent context");
    expect(() => defineState("llm-space.internal", () => 0)).toThrow(
      "reserved"
    );
  });

  test("extension config validates synchronously", () => {
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate(value: unknown) {
          const record = value as { token?: unknown };
          return typeof record?.token === "string"
            ? { value: { token: record.token } }
            : { issues: [{ message: "token is required" }] };
        },
      },
    };
    const extension = defineExtension({ config: schema });
    expect(() => extension({})).toThrow("token is required");
  });
});
