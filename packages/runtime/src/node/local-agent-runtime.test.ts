import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "bun:test";

import { LocalAgentRuntime } from "./local-agent-runtime";
import { InMemorySessionStore } from "../runtime/harness/in-memory-session-store";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

describe("LocalAgentRuntime", () => {
  test("builds from the required definition before creating sessions", async () => {
    const agentRoot = await _fixture();
    let executions = 0;
    await writeFile(
      join(agentRoot, "tools", "echo.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";

      export default defineTool({
        description: "Echo text.",
        inputSchema: Type.Object({ text: Type.String() }),
        execute(input) {
          return { text: "echo:" + input.text, echoed: input.text };
        }
      });`
    );
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => {
        executions += 1;
      })
    });

    const session = await runtime.createSession({ id: "thread-one" });
    await session.prompt("hello");

    expect(runtime.project.definition).toEqual({
      model: { provider: "fake", id: "fake-model" },
      limits: { maxModelCallsPerRun: 25 },
      reasoning: "high"
    });
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(executions).toBe(2);
  });

  test("resolves Eve-shaped model and tools into one durable Turn snapshot", async () => {
    const agentRoot = await _fixture();
    await writeFile(
      join(agentRoot, "agent.ts"),
      `import { defineAgent, defineDynamic } from "@llm-space/runtime";
      export default defineAgent({
        model: defineDynamic({
          fallback: "fake/fake-model",
          events: {
            "turn.started": (_event, ctx) => ({
              model: "fake/fake-model",
              modelOptions: { temperature: ctx.session.channel.kind === "test" ? 0.4 : 0.2 }
            })
          }
        }),
        reasoning: "high"
      });`
    );
    await writeFile(
      join(agentRoot, "tools", "tenant.ts"),
      `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      let resolutions = 0;
      export default defineDynamic({
        events: {
          "turn.started": (_event, ctx) => {
            if (++resolutions > 1) throw new Error("resolver reran");
            const prefix = ctx.session.channel.kind;
            return {
              echo: defineTool({
                description: "Echo with channel.",
                inputSchema: Type.Object({ text: Type.String() }),
                outputSchema: Type.Object({ text: Type.String() }),
                execute(input) { return { text: prefix + ":" + input.text }; }
              })
            };
          }
        }
      });`
    );
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => {})
    });
    const store = new InMemorySessionStore();
    const principal = {
      issuer: "test",
      principalId: "dynamic-user",
      principalType: "runtime" as const
    };
    const session = await runtime.createSession({
      context: {
        id: "dynamic-session",
        auth: { initiator: principal, current: principal },
        channel: { kind: "test" },
        turn: { id: "dynamic-turn", sequence: 1 }
      },
      sessionStore: store
    });

    expect(session.capabilitySnapshot).toMatchObject({
      model: { provider: "fake", id: "fake-model" },
      modelOptions: { temperature: 0.4 },
      turnId: "dynamic-turn",
      tools: [{
        name: "echo",
        contributionId: "tool-resolver:tools/tenant.ts",
        outputSchema: expect.any(Object)
      }]
    });
    const recorded = await store.load("dynamic-session");
    expect(recorded?.snapshot.instructionSnapshots?.["dynamic-turn"])
      .toBeDefined();
    expect(recorded?.snapshot.capabilitySnapshots?.["dynamic-turn"])
      .toEqual(session.capabilitySnapshot ?? undefined);
    expect(recorded?.journal.slice(-2).map(entry => entry.type)).toEqual([
      "turnInstructionsRecorded",
      "turnCapabilitiesRecorded"
    ]);
    expect(new Set(recorded?.journal.slice(-2).map(
      entry => entry.sessionVersion
    ))).toEqual(new Set([1]));

    await session.prompt("hello");
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    const reloaded = await runtime.createSession({
      context: {
        id: "dynamic-session",
        auth: { initiator: principal, current: principal },
        channel: { kind: "changed" },
        turn: { id: "dynamic-turn", sequence: 1 }
      },
      initialMessages: session.messages,
      sessionStore: store
    });
    expect(reloaded.capabilitySnapshot).toEqual(session.capabilitySnapshot);
    await reloaded.prompt("again");
    expect(reloaded.messages.at(-1)?.role).toBe("assistant");
    expect(await _rejection(runtime.createSession({
      context: {
        id: "dynamic-session",
        auth: { initiator: principal, current: principal },
        channel: { kind: "test" },
        turn: { id: "dynamic-turn", sequence: 1 }
      },
      modelOptions: { temperature: 0.8 },
      sessionStore: store
    }))).toMatchObject({
      message: "The Turn capability request changed after its snapshot was recorded"
    });
    try {
      await runtime.createSession({
        capabilityPolicy: {
          connectionContributions: [],
          modelOptions: {},
          models: [{ provider: "fake", id: "fake-model" }],
          reasoning: ["high"],
          toolContributions: []
        },
        context: {
          id: "dynamic-session",
          auth: { initiator: principal, current: principal },
          channel: { kind: "test" },
          turn: { id: "dynamic-turn", sequence: 1 }
        },
        sessionStore: store
      });
      throw new Error("Expected changed Host policy to reject.");
    } catch (error) {
      expect(error).toMatchObject({ name: "AgentHostPolicyChangedError" });
    }
  });

  test("rejects a dynamic tool whose execute callback is not inline", async () => {
    const agentRoot = await _fixture();
    await writeFile(
      join(agentRoot, "tools", "invalid.ts"),
      `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      const execute = () => ({ ok: true });
      export default defineDynamic({
        events: {
          "turn.started": () => defineTool({
            description: "Invalid replay callback.",
            inputSchema: Type.Object({}),
            execute
          })
        }
      });`
    );

    try {
      await LocalAgentRuntime.create({
        agentRoot,
        models: _fakeModels(() => {})
      });
      throw new Error("Expected invalid dynamic tool source to reject.");
    } catch (error) {
      expect(error).toMatchObject({
        message: expect.stringContaining(
          "dynamic tool execute must be an inline function"
        )
      });
    }
  });

  test("skips only a failing dynamic tool resolver", async () => {
    const agentRoot = await _fixture();
    await writeFile(
      join(agentRoot, "tools", "failing.ts"),
      `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineDynamic({
        events: {
          "turn.started": () => {
            defineTool({
              description: "Unavailable tool.",
              inputSchema: Type.Object({}),
              execute: () => ({ ok: false })
            });
            throw new Error("unavailable");
          }
        }
      });`
    );
    await writeFile(
      join(agentRoot, "tools", "working.ts"),
      `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineDynamic({
        events: {
          "turn.started": () => ({
            working: defineTool({
              description: "Working tool.",
              inputSchema: Type.Object({}),
              execute: () => ({ ok: true })
            })
          })
        }
      });`
    );
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => {})
    });
    const session = await runtime.createSession({
      id: "resolver-skip",
      sessionStore: new InMemorySessionStore()
    });

    expect(session.capabilitySnapshot?.tools.map(tool => tool.name))
      .toEqual(["working"]);
  });

  test("fails a Turn when dynamic tool resolvers claim the same name", async () => {
    const agentRoot = await _fixture();
    for (const source of ["first", "second"]) {
      await writeFile(
        join(agentRoot, "tools", `${source}.ts`),
        `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
        import { Type } from "typebox";
        export default defineDynamic({
          events: {
            "turn.started": () => ({
              duplicate: defineTool({
                description: "${source} tool.",
                inputSchema: Type.Object({}),
                execute: () => ({ source: "${source}" })
              })
            })
          }
        });`
      );
    }
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => {})
    });

    expect(await _rejection(runtime.createSession({
      id: "resolver-collision",
      sessionStore: new InMemorySessionStore()
    })))
      .toMatchObject({
        message: expect.stringContaining("Dynamic tool duplicate collides")
      });
  });

  test("fails before Pi when a dynamic tool closure is not serializable", async () => {
    const agentRoot = await _fixture();
    await writeFile(
      join(agentRoot, "tools", "closure.ts"),
      `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineDynamic({
        events: {
          "turn.started": () => {
            function format(value) { return "value:" + value; }
            return defineTool({
              description: "Invalid closure.",
              inputSchema: Type.Object({ value: Type.String() }),
              execute: ({ value }) => ({ value: format(value) })
            });
          }
        }
      });`
    );
    let providerCalls = 0;
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => { providerCalls += 1; })
    });

    expect(await _rejection(runtime.createSession({
      id: "invalid-closure",
      sessionStore: new InMemorySessionStore()
    }))).toBeInstanceOf(Error);
    expect(providerCalls).toBe(0);
  });

  test("rejects an invalid dynamic tool name before Pi", async () => {
    const agentRoot = await _fixture();
    await writeFile(
      join(agentRoot, "tools", "names.ts"),
      `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineDynamic({
        events: {
          "turn.started": () => ({
            "invalid name": defineTool({
              description: "Invalid name.",
              inputSchema: Type.Object({}),
              execute: () => ({ ok: true })
            })
          })
        }
      });`
    );
    let providerCalls = 0;
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => { providerCalls += 1; })
    });

    expect(await _rejection(runtime.createSession({
      id: "invalid-name",
      sessionStore: new InMemorySessionStore()
    }))).toMatchObject({ message: "Invalid dynamic tool name: invalid name" });
    expect(providerCalls).toBe(0);
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-runtime-session-"));
  ROOTS.push(root);
  await mkdir(join(root, "tools"), { recursive: true });
  await writeFile(
    join(root, "agent.ts"),
    `export default { model: "fake/fake-model", reasoning: "high" };`
  );
  await writeFile(join(root, "instructions.md"), "Always use echo.\n");
  return root;
}

function _fakeModels(onStream: () => void) {
  const model: Model<"fake"> = {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
  const api = {
    stream: (_model: Model<Api>, context: Context) => {
      onStream();
      return _fakeStream(context);
    },
    streamSimple: (_model: Model<Api>, context: Context) => {
      onStream();
      return _fakeStream(context);
    }
  };
  const provider = createProvider({
    id: "fake",
    auth: {
      apiKey: {
        name: "Fake",
        resolve: async () => Promise.resolve({ auth: {} })
      }
    },
    models: [model],
    api
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}

function _fakeStream(context: Context) {
  const stream = createAssistantMessageEventStream();
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    role: "assistant",
    content: hasToolResult
      ? [{ type: "text", text: "done" }]
      : [
        {
          type: "toolCall",
          id: "call-one",
          name: "echo",
          arguments: { text: "hello" }
        }
      ],
    api: "fake",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: hasToolResult ? "stop" : "toolUse",
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasToolResult ? "stop" : "toolUse",
      message
    });
  });
  return stream;
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}
