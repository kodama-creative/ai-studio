import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import {
  InMemorySessionStore,
  type RuntimeRunConfigurationSnapshot,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import {
  AgentHostPolicyChangedError,
  ExecutionEnvUnavailableError
} from "@llm-space/runtime/node";
import { afterEach, describe, expect, test } from "bun:test";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type {
  BuiltinTool,
  McpTool,
  ProjectTool,
  ThreadAgentRuntimeProvenance,
  ThreadServerRunLineage
} from "@llm-space/core";

import { StreamThreadController } from "./stream-thread";
import { ExternalAgentProjectManager } from "../external-projects";
import { EmbeddedLocalServerManager } from "../local-server";

const roots: string[] = [];
const managers: ExternalAgentProjectManager[] = [];
const LOCAL_SERVER_MANAGERS: EmbeddedLocalServerManager[] = [];

afterEach(async () => {
  await Promise.all(
    LOCAL_SERVER_MANAGERS.splice(0).map(async manager => manager.shutdown())
  );
  await Promise.all(managers.splice(0).map(async manager => manager.shutdown()));
  await Promise.all(
    roots.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

describe("StreamThreadController Agent Project runtime", () => {
  test("reports a Host policy change with an explicit terminal code", async () => {
    const manager = {
      readThread: async () => Promise.resolve({
        thread: { runtimeProfile: { type: "desktopDirect" } }
      }),
      requiresRuntimeSessionStore: async () => Promise.resolve(false),
      createRuntimeSession: async () => {
        throw new AgentHostPolicyChangedError();
      }
    } as unknown as ExternalAgentProjectManager;
    const controller = new StreamThreadController(
      _modelManager(createModels()),
      { capture: () => undefined } as never,
      manager
    );
    const responses: unknown[] = [];

    await controller.run({
      streamId: "stream-host-policy-changed",
      runtime: {
        type: "agentProject",
        sandboxAttachmentMessageIds: [],
        projectId: "project-one",
        threadId: "thread-one",
        executionMode: "react",
        modelSource: "agent"
      },
      request: {
        model: { provider: "fake", id: "fake-model" },
        context: { messages: [], tools: [], sourceTools: [] }
      }
    }, message => {
      responses.push(message);
    });

    expect(responses).toEqual([{
      streamId: "stream-host-policy-changed",
      type: "error",
      code: "hostPolicyChanged",
      message: "The Host capability policy changed after this Turn was recorded"
    }]);
  });

  test("reports a missing ExecutionEnv without a Desktop host fallback", async () => {
    const manager = {
      readThread: async () => Promise.resolve({
        thread: { runtimeProfile: { type: "desktopDirect" } }
      }),
      requiresRuntimeSessionStore: async () => Promise.resolve(false),
      createRuntimeSession: async () => {
        throw new ExecutionEnvUnavailableError();
      }
    } as unknown as ExternalAgentProjectManager;
    const controller = new StreamThreadController(
      _modelManager(createModels()),
      { capture: () => undefined } as never,
      manager
    );
    const responses: unknown[] = [];

    await controller.run({
      streamId: "stream-execution-env-unavailable",
      runtime: {
        type: "agentProject",
        sandboxAttachmentMessageIds: [],
        projectId: "project-one",
        threadId: "thread-one",
        executionMode: "react",
        modelSource: "agent"
      },
      request: {
        model: { provider: "fake", id: "fake-model" },
        context: { messages: [], tools: [], sourceTools: [] }
      }
    }, message => {
      responses.push(message);
    });

    expect(responses).toEqual([{
      streamId: "stream-execution-env-unavailable",
      type: "error",
      code: "executionEnvUnavailable",
      message: "The selected tools require a Host-provided ExecutionEnv"
    }]);
  });

  test("fails before Pi when a selected connection tool is unavailable", async () => {
    const manager = {
      getActiveRemoteToolNames: () => new Set<string>()
    } as unknown as ExternalAgentProjectManager;
    const controller = new StreamThreadController(
      _modelManager(createModels()),
      { capture: () => undefined } as never,
      manager
    );
    const responses: unknown[] = [];
    const remoteTool: ProjectTool = {
      type: "project",
      name: "fixture__echo",
      description: "Remote echo.",
      parameters: { type: "object", properties: {} },
      projectId: "project-one",
      snapshot: "snapshot-one",
      sourcePath: "connections/fixture.ts",
      connectionName: "fixture",
      remoteToolName: "echo",
      schemaFingerprint: "schema-one"
    };

    await controller.run({
      streamId: "stream-connection-unavailable",
      runtime: {
        type: "agentProject",
        sandboxAttachmentMessageIds: [],
        projectId: "project-one",
        threadId: "thread-one",
        executionMode: "react",
        modelSource: "agent"
      },
      request: {
        model: { provider: "fake", id: "fake-model" },
        context: {
          messages: [],
          tools: [remoteTool],
          sourceTools: [remoteTool]
        }
      }
    }, message => {
      responses.push(message);
    });

    expect(responses).toEqual([{
      streamId: "stream-connection-unavailable",
      type: "error",
      message: "Selected connection tool is unavailable: fixture__echo"
    }]);
  });

  test("locks Sandbox attachments by renderer-selected message identity", async () => {
    const lockedMessageIds: Array<readonly string[]> = [];
    const descriptor = {
      id: "attachment-one",
      name: "notes.txt",
      path: "/workspace/.llm-space-attachments-fixture/notes.txt",
      size: 5,
      fingerprint: "a".repeat(64)
    };
    const manager = {
      requiresRuntimeSessionStore: async () => Promise.resolve(false),
      readThread: async () => Promise.resolve({
        thread: {
          runtimeProfile: { type: "desktopSandbox" },
          sandboxAttachments: {
            "message-selected": [descriptor],
            "message-collision": [descriptor]
          }
        }
      }),
      lockSandboxAttachments: async (
        _projectId: string,
        _threadId: string,
        messageIds: readonly string[]
      ) => {
        lockedMessageIds.push(messageIds);
        throw new Error("stop after lock");
      }
    } as unknown as ExternalAgentProjectManager;
    const controller = new StreamThreadController(
      _modelManager(createModels()),
      { capture: () => undefined } as never,
      manager
    );

    await controller.run({
      streamId: "stream-sandbox-attachment-identity",
      runtime: {
        type: "agentProject",
        sandboxAttachmentMessageIds: ["message-selected"],
        projectId: "project-one",
        threadId: "thread-one",
        executionMode: "react",
        modelSource: "agent"
      },
      request: {
        model: { provider: "fake", id: "fake-model" },
        context: {
          messages: [{
            role: "user",
            content: [{
              type: "text",
              text: "<attachments>\n- notes.txt: /workspace/.llm-space-attachments-fixture/notes.txt\n</attachments>"
            }],
            timestamp: Date.now()
          }],
          tools: [],
          sourceTools: []
        }
      }
    }, () => undefined);

    expect(lockedMessageIds).toEqual([["message-selected"]]);
  });

  test("persists dynamic Turn instructions before Desktop Project execution and reopens them", async () => {
    const { home, models, manager, opened, project, threadId, workspace } =
      await _fixture({
        dynamicInstructions: true,
        instructions: "Root instructions.\n",
        projectTool: true
      });
    const begun = await _beginProjectRun(manager, opened.id, threadId);
    const activeRunId = begun.snapshot.activeRunId;
    if (!activeRunId) { throw new Error("Expected an active Runtime Run"); }
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager
    );

    await controller.run(
      {
        streamId: "stream-dynamic-instructions",
        runtime: {
          type: "agentProject",
          sandboxAttachmentMessageIds: [],
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          context: {
            systemPrompt: "Edited Thread instructions.",
            messages: [{
              role: "user",
              content: [{ type: "text", text: "hello" }],
              timestamp: Date.now()
            }],
            tools: opened.tools,
            sourceTools: opened.tools
          }
        }
      },
      () => undefined
    );

    const persisted = await manager.readThread(opened.id, threadId);
    const runtimeSnapshot = (
      persisted.thread.runtimeSession as StoredRuntimeSession
    ).snapshot;
    const snapshot = runtimeSnapshot.instructionSnapshots?.[activeRunId];
    expect(snapshot).toMatchObject({
      turnId: activeRunId,
      markdown: `Edited Thread instructions.\n\ndesktop:${threadId}:local-user`
    });
    expect(snapshot?.entries.map(entry => entry.sourcePath)).toEqual([
      "host:system-prompt",
      "instructions/turn.ts"
    ]);
    const capabilitySnapshot = runtimeSnapshot.capabilitySnapshots?.[
      activeRunId
    ];
    expect(capabilitySnapshot).toMatchObject({
      turnId: activeRunId,
      model: { provider: "fake", id: "fake-model" }
    });
    expect(capabilitySnapshot?.tools.map(tool => tool.name)).toContain("echo");

    await manager.shutdown();
    const reopened = new ExternalAgentProjectManager({
      homePath: home,
      workspaceRoot: workspace,
      getModels: async () => Promise.resolve(models)
    });
    managers.push(reopened);
    await reopened.trustAndOpen(project);
    const runtimeState = await reopened.createRuntimeSessionStore(
      opened.id,
      threadId
    );
    expect(runtimeState.session.snapshot.instructionSnapshots?.[activeRunId])
      .toEqual(snapshot);
    expect(runtimeState.session.snapshot.capabilitySnapshots?.[activeRunId])
      .toEqual(capabilitySnapshot);
  });

  test("commits Project state to the Thread before the next model turn and reopens it", async () => {
    const { home, models, manager, opened, project, threadId, workspace } =
      await _fixture({
        instructions: "Increment state.\n",
        stateful: true,
        toolCall: { name: "increment", arguments: {} }
      });
    const begun = await _beginProjectRun(manager, opened.id, threadId);
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager
    );
    let committed: StoredRuntimeSession | undefined;

    await controller.run(
      {
        streamId: "stream-stateful-project",
        runtime: {
          type: "agentProject",
          sandboxAttachmentMessageIds: [],
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          context: {
            systemPrompt: opened.instructions,
            messages: [{
              role: "user",
              content: [{ type: "text", text: "increment" }],
              timestamp: Date.now()
            }],
            tools: opened.tools,
            sourceTools: opened.tools
          }
        }
      },
      message => {
        if (message.type === "runtimeSession") {
          committed = message.runtimeSession;
        }
      }
    );

    const persisted = await manager.readThread(opened.id, threadId);
    expect(committed?.version).toBe(begun.version + 2);
    expect((persisted.thread.runtimeSession as StoredRuntimeSession)
      .snapshot.state?.values["desktop.counter"]?.value).toEqual({
      count: 1,
      principalId: "local-user",
      channel: "desktop"
    });
    await manager.shutdown();
    const reopened = new ExternalAgentProjectManager({
      homePath: home,
      workspaceRoot: workspace,
      getModels: async () => Promise.resolve(models)
    });
    managers.push(reopened);
    await reopened.trustAndOpen(project);
    const runtimeState = await reopened.createRuntimeSessionStore(
      opened.id,
      threadId
    );
    expect(runtimeState.session.snapshot.state?.values["desktop.counter"]?.value)
      .toEqual({
        count: 1,
        principalId: "local-user",
        channel: "desktop"
      });
  });

  test("runs the same compiled Agent through a restart-safe Local Server authority", async () => {
    const {
      home,
      models,
      manager,
      opened,
      threadId: directThreadId,
      workspace
    } = await _fixture({
      instructions: "Use echo.\n",
      projectTool: true
    });
    await _beginProjectRun(manager, opened.id, directThreadId);
    let directResult = "";
    const directController = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager
    );
    await directController.run(
      {
        streamId: "stream-direct-parity",
        runtime: {
          type: "agentProject",
          sandboxAttachmentMessageIds: [],
          projectId: opened.id,
          threadId: directThreadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          context: {
            systemPrompt: opened.instructions,
            messages: [{
              role: "user",
              content: [{ type: "text", text: "hello" }],
              timestamp: Date.now()
            }],
            tools: opened.tools,
            sourceTools: opened.tools
          }
        }
      },
      message => {
        if (message.type === "event") {
          directResult = _finalAssistantText(message.event) ?? directResult;
        }
      }
    );
    const serverThread = await manager.createThread(
      opened.id,
      "Local Server parity",
      "localServer"
    );
    const threadId = serverThread.id;
    const localServers = new EmbeddedLocalServerManager({
      externalAgentProjects: manager,
      homePath: home,
      models
    });
    LOCAL_SERVER_MANAGERS.push(localServers);
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      undefined,
      undefined,
      localServers
    );
    const messages: string[] = [];
    let serverResult = "";
    let lineage: ThreadServerRunLineage | undefined;
    await controller.run(
      _localServerRequest(opened.id, threadId, "hello"),
      message => {
        messages.push(message.type);
        if (message.type === "localServerLineage") {
          lineage = message.lineage;
        } else if (message.type === "event") {
          serverResult = _finalAssistantText(message.event) ?? serverResult;
        }
      }
    );
    expect(messages).toContain("event");
    expect(messages.at(-1)).toBe("done");
    expect(serverResult).toBe(directResult);
    expect(serverResult).toBe("done");
    expect(lineage?.profile).toBe("localServer");
    expect(lineage?.artifactFingerprint).toBe(opened.artifactFingerprint);
    expect(lineage?.sessionId).toMatch(/^session-/);
    expect(lineage?.runId).toMatch(/^run-/);
    const firstSessionId = lineage?.sessionId;
    const firstRunId = lineage?.runId;
    const persisted = await manager.readThread(opened.id, threadId);
    expect(persisted.thread.runtimeProfile).toEqual({
      version: 1,
      type: "localServer",
      artifactFingerprint: opened.artifactFingerprint,
      serverSessionId: lineage?.sessionId
    });
    expect(persisted.thread.runtimeSession).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain("continuationToken");

    await localServers.shutdown();
    const restarted = new EmbeddedLocalServerManager({
      externalAgentProjects: manager,
      homePath: home,
      models
    });
    LOCAL_SERVER_MANAGERS.push(restarted);
    expect(await restarted.status(opened.id, threadId)).toEqual({
      state: "ready"
    });
    const restartedController = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      undefined,
      undefined,
      restarted
    );
    let secondLineage: ThreadServerRunLineage | undefined;
    await restartedController.run(
      _localServerRequest(opened.id, threadId, "again"),
      message => {
        if (message.type === "localServerLineage") {
          secondLineage = message.lineage;
        }
      }
    );
    expect(secondLineage?.sessionId).toBe(firstSessionId);
    expect(secondLineage?.runId).not.toBe(firstRunId);

    let abortedOutcome: string | undefined;
    await restartedController.run(
      _localServerRequest(opened.id, threadId, "abort-me"),
      message => {
        if (
          message.type === "localServerLineage"
          && !message.terminalOutcome
        ) {
          restartedController.abort({ streamId: "stream-abort-me" });
        }
        if (message.type === "localServerLineage") {
          abortedOutcome = message.terminalOutcome ?? abortedOutcome;
        }
      }
    );
    expect(abortedOutcome).toBe("cancelled");

    await restarted.shutdown();
    await manager.writeSource(opened.id, "instructions.md", "Changed source.\n");
    const changed = await manager.refresh(opened.id);
    expect(changed.artifactFingerprint).not.toBe(opened.artifactFingerprint);
    await manager.shutdown();
    const managerAfterRestart = new ExternalAgentProjectManager({
      homePath: home,
      workspaceRoot: workspace,
      getModels: async () => Promise.resolve(models)
    });
    managers.push(managerAfterRestart);
    expect((await managerAfterRestart.inspect(opened.id)).artifactFingerprint)
      .toBe(changed.artifactFingerprint);
    const detachedAfterRestart = new EmbeddedLocalServerManager({
      externalAgentProjects: managerAfterRestart,
      homePath: home,
      models
    });
    LOCAL_SERVER_MANAGERS.push(detachedAfterRestart);
    await detachedAfterRestart.detachThread(opened.id, threadId);
    expect(
      await Bun.file(
        path.join(home, "credentials", "local-server.json")
      ).json()
    ).toEqual({ version: 1, entries: [] });
    expect(await detachedAfterRestart.status(opened.id, threadId)).toEqual({
      state: "stale",
      message: "This Thread is bound to an older compiled Agent artifact."
    });
  });

  test("reports a missing Local Server Host model as unavailable", async () => {
    const { home, manager, models, opened, threadId } = await _fixture({
      instructions: "Answer briefly.\n"
    });
    const record = await manager.readThread(opened.id, threadId);
    await manager.writeThread(opened.id, threadId, {
      ...record,
      thread: {
        ...record.thread,
        runtimeProfile: {
          version: 1,
          type: "localServer",
          artifactFingerprint: opened.artifactFingerprint
        }
      }
    });
    const localServers = new EmbeddedLocalServerManager({
      externalAgentProjects: manager,
      homePath: home,
      models: createModels()
    });
    LOCAL_SERVER_MANAGERS.push(localServers);
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      undefined,
      undefined,
      localServers
    );
    const responses: Array<{
      message?: string;
      state?: string;
      type: string;
    }> = [];
    await controller.run(
      _localServerRequest(opened.id, threadId, "hello"),
      message => {
        responses.push({
          type: message.type,
          ...(message.type === "localServerStatus"
            ? { state: message.status.state, message: message.status.message }
            : message.type === "error"
              ? { message: message.message }
              : {})
        });
      }
    );
    const message =
      "The Local Server could not start. Verify its Host model credentials and try again.";
    expect(responses).toContainEqual({
      type: "localServerStatus",
      state: "unavailable",
      message
    });
    expect(responses.at(-1)).toEqual({ type: "error", message });
  });

  test("streams a complete Pi Agent ReAct run without Bun-side transcript persistence", async () => {
    const { models, manager, opened, threadId } = await _fixture({
      instructions: "Use echo.\n",
      projectTool: true
    });
    await _beginProjectRun(manager, opened.id, threadId);
    const events: string[] = [];
    let runtimeProvenance: ThreadAgentRuntimeProvenance | undefined;
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager
    );

    await controller.run(
      {
        streamId: "stream-one",
        runtime: {
          type: "agentProject",
          sandboxAttachmentMessageIds: [],
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          config: { model: { reasoning: "high" } },
          context: {
            systemPrompt: opened.instructions,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "hello" }],
                timestamp: Date.now()
              }
            ],
            tools: opened.tools,
            sourceTools: opened.tools
          }
        }
      },
      message => {
        if (message.type === "runtime") {
          runtimeProvenance = message.runtime;
        }
        events.push(
          message.type === "event" ? message.event.type : message.type
        );
      }
    );

    expect(runtimeProvenance).toEqual({
      projectId: opened.id,
      snapshot: opened.snapshot,
      definitionFingerprint: opened.definitionFingerprint,
      modelSource: "agent"
    });
    expect(events).toContain("tool_execution_end");
    expect(events.at(-1)).toBe("done");
    const persisted = await manager.readThread(opened.id, threadId);
    expect(persisted.thread.context?.messages ?? []).toEqual([]);
  });

  test("leaves a dangerous bash call pending in the runtime ReAct loop", async () => {
    const { models, manager, opened, threadId } = await _fixture({
      instructions: "Be careful.\n",
      toolCall: {
        name: "bash",
        arguments: { command: "rm -rf /tmp/should-not-run" }
      }
    });
    await _beginProjectRun(manager, opened.id, threadId);
    let executions = 0;
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      undefined,
      {
        call: async () => {
          executions += 1;
          return Promise.resolve({ contentText: "executed", isError: false });
        }
      } as never
    );
    const bashTool: BuiltinTool = {
      type: "builtin",
      name: "bash",
      description: "Execute a shell command.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
      }
    };

    await controller.run(
      {
        streamId: "stream-risky-bash",
        runtime: {
          type: "agentProject",
          sandboxAttachmentMessageIds: [],
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          config: { model: { reasoning: "high" } },
          context: {
            systemPrompt: opened.instructions,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "clean up" }],
                timestamp: Date.now()
              }
            ],
            tools: [bashTool],
            sourceTools: [bashTool]
          }
        }
      },
      () => undefined
    );

    expect(executions).toBe(0);
    const persisted = await manager.readThread(opened.id, threadId);
    const assistant = persisted.thread.context?.messages?.[1];
    expect(
      assistant?.role === "assistant"
        ? assistant.toolCalls?.[0]?.output
        : undefined
    ).toBeUndefined();
  });

  test("projects an MCP-declared error as a failed tool result", async () => {
    const toolName = "mcp__server__fail";
    const { models, manager, opened, threadId } = await _fixture({
      instructions: "Use MCP.\n",
      toolCall: { name: toolName, arguments: {} }
    });
    await _beginProjectRun(manager, opened.id, threadId);
    let toolResultIsError: boolean | undefined;
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      {
        callTool: async () =>
          Promise.resolve({ contentText: "MCP failed", isError: true })
      } as never
    );
    const mcpTool: McpTool = {
      type: "mcp",
      name: toolName,
      description: "Return an MCP error.",
      parameters: { type: "object", properties: {} },
      serverId: "server-id",
      serverName: "server",
      toolName: "fail"
    };

    await controller.run(
      {
        streamId: "stream-mcp-error",
        runtime: {
          type: "agentProject",
          sandboxAttachmentMessageIds: [],
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          config: { model: { reasoning: "high" } },
          context: {
            systemPrompt: opened.instructions,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "call MCP" }],
                timestamp: Date.now()
              }
            ],
            tools: [mcpTool],
            sourceTools: [mcpTool]
          }
        }
      },
      message => {
        if (
          message.type === "event"
          && message.event.type === "tool_execution_end"
        ) {
          toolResultIsError = message.event.isError;
        }
      }
    );

    expect(toolResultIsError).toBe(true);
  });
});

describe("StreamThreadController standalone Runtime Harness", () => {
  test.each([
    ["manual", 0, 1],
    ["autoOnce", 1, 1],
    ["react", 1, 2]
  ] as const)(
    "uses Pi Agent ownership for %s execution",
    async (executionMode, expectedExecutions, expectedAssistantStarts) => {
      const models = _models();
      let executions = 0;
      let assistantStarts = 0;
      const controller = new StreamThreadController(
        _modelManager(models),
        { capture: () => undefined } as never,
        undefined,
        undefined,
        {
          call: async () => {
            executions += 1;
            return Promise.resolve({ contentText: "hello", isError: false });
          }
        } as never
      );
      const tool: BuiltinTool = {
        type: "builtin",
        name: "echo",
        description: "Echo text.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        }
      };

      await controller.run(
        {
          streamId: `standalone-${executionMode}`,
          runtime: { type: "desktopThread", executionMode },
          request: {
            model: { provider: "fake", id: "fake-model" },
            context: {
              systemPrompt: "Use echo.",
              messages: [
                {
                  role: "user",
                  content: [{ type: "text", text: "hello" }],
                  timestamp: Date.now()
                }
              ],
              tools: [tool],
              sourceTools: [tool]
            }
          }
        },
        message => {
          if (
            message.type === "event"
            && message.event.type === "message_start"
            && message.event.message.role === "assistant"
          ) {
            assistantStarts += 1;
          }
        }
      );

      expect(executions).toBe(expectedExecutions);
      expect(assistantStarts).toBe(expectedAssistantStarts);
    }
  );
});

async function _fixture({
  dynamicInstructions = false,
  instructions,
  toolCall,
  projectTool = false,
  stateful = false
}: {
  dynamicInstructions?: boolean;
  instructions: string;
  projectTool?: boolean;
  stateful?: boolean;
  toolCall?: { arguments: Record<string, unknown>; name: string; };
}) {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-stream-runtime-"));
  roots.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(home, "workspace");
  const project = path.join(root, "project");
  const agent = path.join(project, "agent");
  await mkdir(projectTool || stateful ? path.join(agent, "tools") : agent, {
    recursive: true
  });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(project, "llm-space.json"),
    JSON.stringify({ schemaVersion: 1, agent: "./agent" })
  );
  await writeFile(
    path.join(agent, "agent.ts"),
    `export default { model: "fake/fake-model", reasoning: "high" };`
  );
  await writeFile(path.join(agent, "instructions.md"), instructions);
  if (dynamicInstructions) {
    await mkdir(path.join(agent, "instructions"));
    await writeFile(
      path.join(agent, "instructions", "turn.ts"),
      `import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
      export default defineDynamic({ events: {
        "turn.started": (_event, { session }) => defineInstructions({
          markdown: session.channel.kind + ":" + session.channel.id + ":"
            + session.auth.current.principalId
        })
      }});`
    );
  }
  if (projectTool) {
    await writeFile(
      path.join(agent, "tools", "echo.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Echo text.",
        inputSchema: Type.Object({ text: Type.String() }),
        execute({ text }) { return text; }
      });`
    );
  }
  if (stateful) {
    await mkdir(path.join(agent, "state"));
    await writeFile(
      path.join(agent, "state", "counter.ts"),
      `import { defineState } from "@llm-space/runtime/state";
      import { Type } from "typebox";
      export default defineState({
        name: "desktop.counter",
        version: 1,
        schema: Type.Object({
          count: Type.Number(),
          principalId: Type.String(),
          channel: Type.String()
        }),
        initial: { count: 0, principalId: "", channel: "" }
      });`
    );
    await writeFile(
      path.join(agent, "tools", "increment.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      import counter from "../state/counter";
      export default defineTool({
        description: "Increment durable state.",
        inputSchema: Type.Object({}),
        execute(_input, context) {
          counter.update(current => ({
            count: current.count + 1,
            principalId: context.session.auth.current.principalId,
            channel: context.session.channel.kind
          }));
          return counter.get();
        }
      });`
    );
  }
  const models = _models(toolCall);
  const manager = new ExternalAgentProjectManager({
    homePath: home,
    workspaceRoot: workspace,
    getModels: async () => Promise.resolve(models)
  });
  managers.push(manager);
  const opened = await manager.trustAndOpen(project);
  return {
    home,
    manager,
    models,
    opened,
    project,
    threadId: opened.threads[0].id,
    workspace
  };
}

async function _beginProjectRun(
  manager: ExternalAgentProjectManager,
  projectId: string,
  threadId: string
): Promise<StoredRuntimeSession> {
  const record = await manager.readThread(projectId, threadId);
  const persisted = record.thread.runtimeSession as
    StoredRuntimeSession | undefined;
  const store = new InMemorySessionStore(persisted ? [persisted] : []);
  let current = persisted;
  if (current?.snapshot.activeRunId) {
    current = await store.commit({
      sessionId: current.snapshot.id,
      expectedVersion: current.version,
      mutations: [{
        type: "transitionRun",
        runId: current.snapshot.activeRunId,
        to: "completed"
      }]
    });
  }
  const sessionId = current?.snapshot.id ?? `session-${crypto.randomUUID()}`;
  const configuration: RuntimeRunConfigurationSnapshot = {
    id: `configuration-${crypto.randomUUID()}`,
    agentSnapshotFingerprint: "desktop-test-agent",
    contextFingerprint: "desktop-test-context",
    executionMode: "react",
    model: { provider: "fake", id: "fake-model" },
    toolConfigurationFingerprint: "desktop-test-tools"
  };
  const begun = await store.commit({
    sessionId,
    expectedVersion: current?.version ?? null,
    mutations: [{
      type: "startRun",
      runId: `run-${crypto.randomUUID()}`,
      configuration
    }]
  });
  await manager.writeThread(projectId, threadId, {
    ...record,
    thread: { ...record.thread, runtimeSession: begun }
  });
  return begun;
}

function _localServerRequest(
  projectId: string,
  threadId: string,
  text: string
) {
  return {
    streamId: `stream-${text}`,
    runtime: {
      type: "localServerAgentProject" as const,
      projectId,
      threadId
    },
    request: {
      model: { provider: "fake", id: "fake-model" },
      context: {
        systemPrompt: "ignored by Server authority",
        messages: [{
          role: "user" as const,
          content: [{ type: "text" as const, text }],
          timestamp: Date.now()
        }],
        tools: []
      }
    }
  };
}

function _finalAssistantText(event: AgentEvent): string | null {
  if (event.type !== "agent_end") {
    return null;
  }
  const assistant = event.messages.findLast(message => message.role === "assistant");
  if (assistant?.role !== "assistant") {
    return null;
  }
  return assistant.content
    .filter(content => content.type === "text")
    .map(content => content.text)
    .join("");
}

function _modelManager(models: ReturnType<typeof _models>) {
  return {
    getAvailableModels: async () => Promise.resolve(models),
    getBaseUrl: () => undefined,
    getHeaders: () => undefined,
    isBuiltin: () => false,
    isBuiltinCatalogModel: () => false
  } as never;
}

function _models(
  toolCall: { arguments: Record<string, unknown>; name: string; } = {
    name: "echo",
    arguments: { text: "hello" }
  }
) {
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
    stream: (_model: Model<Api>, context: Context) =>
      _stream(context, toolCall),
    streamSimple: (_model: Model<Api>, context: Context) =>
      _stream(context, toolCall)
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

function _stream(
  context: Context,
  toolCall: { arguments: Record<string, unknown>; name: string; }
) {
  const stream = createAssistantMessageEventStream();
  const hasResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    role: "assistant",
    content: hasResult
      ? [{ type: "text", text: "done" }]
      : [
        {
          type: "toolCall",
          id: "call-one",
          name: toolCall.name,
          arguments: toolCall.arguments
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
    stopReason: hasResult ? "stop" : "toolUse",
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasResult ? "stop" : "toolUse",
      message
    });
  });
  return stream;
}
