import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model,
  type Models
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";

import { AgentRuntime } from "./agent-runtime";
import { createAgentSubagentTool } from "./create-agent-subagent-tool";
import { defineState } from "../../public/definitions/state";
import {
  defineDynamic as defineDynamicInstructions,
  defineInstructions
} from "../../public/instructions";
import { defineDynamic as defineDynamicModel } from "../../public/models/define-dynamic";
import { defineDynamic as defineDynamicTools } from "../../public/tools/define-dynamic";
import { InMemorySessionStore } from "../harness/in-memory-session-store";
import { decideRuntimeToolApproval } from "../harness/runtime-tool-approval-decision";
import { SandboxUnavailableError } from "../sandbox/sandbox-unavailable-error";

import type {
  AgentProjectSnapshot,
  CompiledAgentProjectSnapshot
} from "./agent-project-snapshot";

describe("AgentRuntime", () => {
  test("runs a declared Subagent as an explicit-message child Session and returns final text", async () => {
    const starts: unknown[] = [];
    const terminals: unknown[] = [];
    const childProject = {
      ..._project(),
      definition: {
        description: "Research one bounded question.",
        model: { provider: "fake", id: "fake-model" }
      },
      instructions: "Child only.",
      fingerprint: "child-snapshot",
      artifact: {
        schemaVersion: 1,
        fingerprint: "child-artifact",
        fingerprints: {} as never
      }
    } as CompiledAgentProjectSnapshot;
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        instructions: "Parent only.",
        subagents: [{
          id: "researcher",
          description: "Research one bounded question.",
          project: childProject
        }]
      }
    });
    const streamFn = async (_model: Model<Api>, context: Context) =>
      _delegationStream(context);
    const session = await runtime.createSession({
      capabilityPolicy: {
        ..._policy(),
        toolContributions: [
          ..._policy().toolContributions,
          "subagent:researcher"
        ]
      },
      context: _context("parent-session"),
      executionMode: "react",
      streamFn,
      subagentHost: {
        prepare(start) {
          starts.push(start);
          return {
            capabilityPolicy: _policy(),
            streamFn
          };
        },
        finish(_identity, terminal) {
          terminals.push(terminal);
        }
      }
    });

    await session.prompt("research this");

    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      message: "bounded task",
      parent: {
        sessionId: "parent-session",
        runId: "turn-parent-session",
        toolCallId: "call-researcher"
      },
      subagent: {
        id: "researcher",
        artifactFingerprint: "child-artifact"
      }
    });
    expect(terminals).toEqual([expect.objectContaining({
      status: "completed",
      result: "child result"
    })]);
    const toolResult = session.messages.find(message =>
      message.role === "toolResult");
    expect(toolResult?.content).toEqual([
      { type: "text", text: "child result" }
    ]);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "parent result" }]
    });
  });

  test("parks the parent delegation while a child-owned approval waits", async () => {
    const childStore = new InMemorySessionStore();
    let childSessionId = "";
    const waits: unknown[] = [];
    const terminals: unknown[] = [];
    const childProject = {
      ..._project(),
      definition: {
        description: "Use one approval-bound action.",
        model: { provider: "fake", id: "fake-model" }
      },
      instructions: "Child approval.",
      tools: [{ ..._tool("approval_action"), approval: "always" }],
      fingerprint: "approval-child",
      artifact: {
        schemaVersion: 1,
        fingerprint: "approval-child-artifact",
        fingerprints: {} as never
      }
    } as CompiledAgentProjectSnapshot;
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        instructions: "Approval parent.",
        subagents: [{
          id: "approver",
          description: "Use one approval-bound action.",
          project: childProject
        }]
      }
    });
    const streamFn = async (_model: Model<Api>, context: Context) =>
      _approvalDelegationStream(context);
    const session = await runtime.createSession({
      capabilityPolicy: {
        ..._policy(),
        toolContributions: ["subagent:approver"]
      },
      context: _context("approval-parent"),
      executionMode: "react",
      sessionStore: new InMemorySessionStore(),
      streamFn,
      subagentHost: {
        async prepare(start) {
          childSessionId = start.child.sessionId;
          await childStore.commit({
            sessionId: start.child.sessionId,
            expectedVersion: null,
            mutations: [{
              type: "startRun",
              runId: start.child.runId,
              messages: [],
              configuration: {
                id: `configuration-${start.child.runId}`,
                agentSnapshotFingerprint:
                  start.subagent.artifactFingerprint,
                contextFingerprint: "child-context",
                executionMode: "react",
                model: { provider: "fake", id: "fake-model" },
                toolConfigurationFingerprint: "child-tools"
              }
            }]
          });
          return {
            capabilityPolicy: {
              ..._policy(),
              toolContributions: ["tool:approval_action"]
            },
            sessionStore: childStore,
            streamFn
          };
        },
        park(_identity, wait) { waits.push(wait); },
        finish(_identity, terminal) { terminals.push(terminal); }
      }
    });

    await session.prompt("delegate approval");

    const stored = await childStore.load(childSessionId);
    expect({
      waits,
      approval: stored?.snapshot.approvalLedger?.requests[0]
    }).toEqual({
      waits: [{ state: "waitingForApproval" }],
      approval: expect.objectContaining({
        state: "pending",
        toolName: "approval_action"
      })
    });
    expect(terminals).toEqual([]);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [expect.objectContaining({
        type: "toolCall",
        name: "approver"
      })]
    });
  });

  test("resumes the same persisted child after approval without rerunning it", async () => {
    const childStore = new InMemorySessionStore();
    const starts: Array<{ child: { runId: string; sessionId: string; }; }> = [];
    let childMessages: AgentMessage[] = [];
    let executions = 0;
    const childProject = {
      ..._project(),
      definition: {
        description: "Use one approval-bound action.",
        model: { provider: "fake", id: "fake-model" }
      },
      instructions: "Child approval.",
      tools: [{
        ..._tool("approval_action"),
        approval: "always" as const,
        async execute() {
          executions += 1;
          return {
            content: [{ type: "text" as const, text: "approved" }],
            details: {}
          };
        }
      }],
      fingerprint: "approval-child",
      artifact: {
        schemaVersion: 1,
        fingerprint: "approval-child-artifact",
        fingerprints: {} as never
      }
    } as CompiledAgentProjectSnapshot;
    const streamFn = async (_model: Model<Api>, context: Context) =>
      _approvalDelegationStream(context);
    const tool = createAgentSubagentTool({
      context: _context("approval-parent-resume"),
      host: {
        async prepare(start) {
          starts.push(start);
          const current = await childStore.load(start.child.sessionId);
          if (!current) {
            await childStore.commit({
              sessionId: start.child.sessionId,
              expectedVersion: null,
              mutations: [{
                type: "startRun",
                runId: start.child.runId,
                messages: [],
                configuration: {
                  id: `configuration-${start.child.runId}`,
                  agentSnapshotFingerprint: start.subagent.artifactFingerprint,
                  contextFingerprint: "child-context",
                  executionMode: "react",
                  model: { provider: "fake", id: "fake-model" },
                  toolConfigurationFingerprint: "child-tools"
                }
              }]
            });
          }
          return {
            capabilityPolicy: {
              ..._policy(),
              toolContributions: ["tool:approval_action"]
            },
            initialMessages: current ? childMessages : [],
            persistence: {
              replaceMessages(messages) {
                childMessages = structuredClone(messages);
              }
            },
            resume: current
              ? { type: "resumeApprovedTools" as const }
              : { type: "prompt" as const },
            sessionStore: childStore,
            streamFn
          };
        }
      },
      models: _reactModels(),
      streamFn,
      subagent: {
        id: "approver",
        description: "Use one approval-bound action.",
        project: childProject
      }
    });
    if (tool.kind !== "executable") {
      throw new Error("Expected executable Subagent tool");
    }

    const first = await tool.execute(
      "call-approver",
      { message: "approve this" }
    );
    const parked = await childStore.load(starts[0]!.child.sessionId);
    const request = parked?.snapshot.approvalLedger?.requests[0];
    if (!parked || !request) { throw new Error("Expected child approval"); }
    await decideRuntimeToolApproval(childStore, {
      actor: _context("approval-parent-resume").auth,
      decision: "approved",
      expectedVersion: parked.version,
      requestId: request.id,
      runId: starts[0]!.child.runId,
      sessionId: starts[0]!.child.sessionId
    });
    const resumed = await tool.execute(
      "call-approver",
      { message: "approve this" }
    );

    expect(first).toEqual({ type: "deferred" });
    expect(starts[1]?.child).toEqual(starts[0]?.child);
    expect(executions).toBe(1);
    expect(resumed).toMatchObject({
      type: "completed",
      result: {
        content: [{ type: "text", text: "child approved result" }],
        details: {
          childSessionId: starts[0]!.child.sessionId,
          childRunId: starts[0]!.child.runId,
          terminalStatus: "completed"
        }
      }
    });
  });

  test("backfills a persisted child terminal without calling the model", async () => {
    let modelCalls = 0;
    const childProject = {
      ..._project(),
      definition: {
        description: "Return one cached answer.",
        model: { provider: "fake", id: "fake-model" }
      },
      artifact: {
        schemaVersion: 1,
        fingerprint: "cached-child-artifact",
        fingerprints: {} as never
      }
    } as CompiledAgentProjectSnapshot;
    const tool = createAgentSubagentTool({
      context: _context("cached-parent"),
      host: {
        prepare() {
          return {
            capabilityPolicy: _policy(),
            resume: {
              type: "terminal",
              terminal: { status: "completed", result: "cached child" }
            }
          };
        }
      },
      models: _reactModels(),
      streamFn: async (_model, context) => {
        modelCalls += 1;
        return _stream(context);
      },
      subagent: {
        id: "cached",
        description: "Return one cached answer.",
        project: childProject
      }
    });
    if (tool.kind !== "executable") {
      throw new Error("Expected executable Subagent tool");
    }

    const outcome = await tool.execute("call-cached", { message: "answer" });

    expect(modelCalls).toBe(0);
    expect(outcome).toMatchObject({
      type: "completed",
      result: {
        content: [{ type: "text", text: "cached child" }],
        details: { terminalStatus: "completed" }
      }
    });
  });

  test("selects shared or isolated child Sandbox from declared fingerprints", async () => {
    const parentSandbox = {
      executionEnv: {} as never,
      revalidationFingerprint: "shared-fingerprint",
      workspaceManifest: ["parent.txt"]
    };
    const cases = [
      {
        name: "undeclared child shares parent",
        childFingerprint: undefined,
        parentSandbox,
        expected: { mode: "shared", fingerprint: "shared-fingerprint" }
      },
      {
        name: "matching declaration shares parent",
        childFingerprint: "shared-fingerprint",
        parentSandbox,
        expected: { mode: "shared", fingerprint: "shared-fingerprint" }
      },
      {
        name: "different declaration is isolated",
        childFingerprint: "isolated-fingerprint",
        parentSandbox,
        expected: { mode: "isolated", fingerprint: "isolated-fingerprint" }
      },
      {
        name: "declared child under direct parent is isolated",
        childFingerprint: "isolated-fingerprint",
        parentSandbox: undefined,
        expected: { mode: "isolated", fingerprint: "isolated-fingerprint" }
      }
    ] as const;

    for (const item of cases) {
      const starts: unknown[] = [];
      const childProject = {
        ..._project(),
        definition: {
          description: item.name,
          model: { provider: "fake", id: "fake-model" }
        },
        instructions: "Child only.",
        ...(item.childFingerprint
          ? {
            sandbox: {
              revalidationFingerprint: item.childFingerprint,
              sourcePath: "sandbox.ts",
              workspace: []
            }
          }
          : {}),
        artifact: {
          schemaVersion: 1,
          fingerprint: `artifact-${item.name}`,
          fingerprints: {} as never
        }
      } as CompiledAgentProjectSnapshot;
      const tool = createAgentSubagentTool({
        context: _context(`sandbox-${item.name}`),
        host: {
          prepare(start) {
            starts.push(start);
            return {
              capabilityPolicy: _policy(),
              sandbox: {
                executionEnv: {} as never,
                revalidationFingerprint: item.childFingerprint,
                workspaceManifest: ["child.txt"]
              }
            };
          }
        },
        models: _reactModels(),
        parentSandbox: item.parentSandbox,
        streamFn: async (_model, context) => _delegationStream(context),
        subagent: {
          id: "sandbox_child",
          description: item.name,
          project: childProject
        }
      });
      if (tool.kind !== "executable") {
        throw new Error("Expected executable Subagent tool");
      }

      const outcome = await tool.execute(
        `call-${item.name}`,
        { message: "inspect sandbox" }
      );

      expect(starts).toEqual([expect.objectContaining({
        sandbox: {
          mode: item.expected.mode,
          revalidationFingerprint: item.expected.fingerprint
        }
      })]);
      expect(outcome).toMatchObject({ type: "completed" });
    }
  });

  test("requires a real Sandbox and snapshots its workspace manifest", async () => {
    const runtime = new AgentRuntime({
      models: _models(),
      project: {
        ..._project(),
        sandbox: {
          revalidationFingerprint: "a".repeat(64),
          sourcePath: "sandbox.ts",
          workspace: []
        }
      }
    });
    const options = {
      capabilityPolicy: _policy(),
      context: _context("sandbox-session")
    };

    expect(await _rejection(runtime.createSession(options)))
      .toBeInstanceOf(SandboxUnavailableError);

    const session = await runtime.createSession({
      ...options,
      sandbox: {
        executionEnv: {} as never,
        workspaceManifest: ["README.md", "src/"]
      }
    });

    expect(session.instructionSnapshot?.entries[0]).toEqual({
      kind: "static",
      markdown:
        "<workspace path=\"/workspace\">\n- \"README.md\"\n- \"src/\"\n</workspace>",
      sourcePath: "host:sandbox-workspace"
    });
  });

  test("owns an immutable project and its definition default", () => {
    const project = _project();
    (project.tools as AgentTool[]).push(_tool("original-tool"));

    const runtime = new AgentRuntime({ models: _models(), project });

    expect(runtime.project).not.toBe(project);
    (project.definition!.model as { id: string; }).id = "mutated-model";
    (project.tools[0] as { name: string; }).name = "mutated-tool";
    (project.tools as AgentTool[]).push(_tool("late-tool"));
    expect(runtime.project.definition?.model.id).toBe("fake-model");
    expect(runtime.project.tools.map(tool => tool.name)).toEqual([
      "original-tool"
    ]);
    expect(Object.isFrozen(runtime.project)).toBe(true);
    expect(Object.isFrozen(runtime.project.definition?.model)).toBe(true);
    expect(Object.isFrozen(runtime.project.tools)).toBe(true);
    expect(Object.isFrozen(runtime.project.tools[0])).toBe(true);
    expect(runtime.defaultModel).toEqual({
      selector: { provider: "fake", id: "fake-model" },
      available: true
    });
  });

  test("requires the Host to supply verified Session context", async () => {
    const runtime = new AgentRuntime({ models: _models(), project: _project() });

    expect(await _rejection(runtime.createSession(
      undefined as never
    ))).toMatchObject({
      message: "Agent Runtime Sessions require Host-verified Session context"
    });
  });

  test("runs project tools through Pi Agent using the definition default", async () => {
    let executions = 0;
    const tool: AgentTool = {
      name: "echo",
      label: "Echo",
      description: "Echo input.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      },
      async execute(_toolCallId, input) {
        executions += 1;
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: `echo:${(input as { text: string; }).text}`
            }
          ],
          details: undefined
        });
      }
    };
    const persisted: AgentMessage[][] = [];
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] }
    });

    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      id: "thread-one",
      context: _context("thread-one"),
      executionMode: "react",
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        }
      }
    });
    const capabilitySnapshot = session.capabilitySnapshot;
    await session.prompt("hello");

    expect(executions).toBe(1);
    expect(session.capabilitySnapshot).toBe(capabilitySnapshot);
    expect(persisted.at(-1)?.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(session.model).toEqual({ provider: "fake", id: "fake-model" });
  });

  test("commits authored state before Pi starts the next model turn", async () => {
    const store = new InMemorySessionStore();
    let providerCalls = 0;
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [{
          ..._tool("echo"),
          async execute() {
            RUNTIME_COUNTER.update(current => ({ count: current.count + 1 }));
            return {
              content: [{ type: "text" as const, text: "updated" }],
              details: {}
            };
          }
        }]
      }
    });
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      id: "stateful-runtime-session",
      context: _context("stateful-runtime-session"),
      sessionStore: store,
      streamFn: async (_model, context) => {
        providerCalls += 1;
        expect(JSON.stringify(context)).not.toContain(
          "stateful-runtime-session"
        );
        expect(JSON.stringify(context)).not.toContain(RUNTIME_COUNTER.name);
        if (providerCalls === 2) {
          expect((await store.load("stateful-runtime-session"))
            ?.snapshot.state?.values[RUNTIME_COUNTER.name]?.value)
            .toEqual({ count: 1 });
        }
        return _stream(context);
      }
    });
    const events: unknown[] = [];
    session.subscribe(event => { events.push(event); });

    await session.prompt("hello");

    expect(providerCalls).toBe(2);
    expect(JSON.stringify(events)).not.toContain(RUNTIME_COUNTER.name);
    expect(JSON.stringify(events)).not.toContain("stateful-runtime-session");
  });

  test("resolves one read-only instruction snapshot per Turn and sends it through Pi", async () => {
    const store = new InMemorySessionStore();
    let resolutions = 0;
    const prompts: string[] = [];
    const events: unknown[] = [];
    const dynamic = defineDynamicInstructions({
      events: {
        "turn.started": (_event, context) => {
          resolutions += 1;
          expect(Object.isFrozen(context.session)).toBe(true);
          expect(Object.isFrozen(context.session.auth.current)).toBe(true);
          expect(context.session.auth.current.principalId).toBe("runtime-test");
          expect(() => {
            (context.session.auth.current as { principalId: string; })
              .principalId = "resolver-spoof";
          }).toThrow();
          const value = RUNTIME_COUNTER.get();
          expect(() => { RUNTIME_COUNTER.update(() => ({ count: 99 })); })
            .toThrow("read-only");
          return defineInstructions({
            markdown: `${context.session.turn.id}:${value.count}`
          });
        }
      }
    });
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        instructions: "Root.",
        instructionEntries: [
          { kind: "static", markdown: "Root.", sourcePath: "instructions.md" },
          {
            kind: "dynamic",
            definition: dynamic,
            sourcePath: "instructions/turn.ts"
          }
        ],
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }]
      }
    });
    const context = _context("instruction-session");
    const first = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      sessionStore: store,
      streamFn: async (_model, piContext) => {
        prompts.push(piContext.systemPrompt ?? "");
        return _stream(piContext);
      }
    });
    first.subscribe(event => { events.push(event); });
    context.auth.current.principalId = "host-mutated-after-validation";

    await first.prompt("hello");
    const recorded = first.instructionSnapshot;
    expect(prompts).toEqual(["Root.\n\nturn-instruction-session:0", "Root.\n\nturn-instruction-session:0"]);
    expect(recorded).toMatchObject({
      markdown: "Root.\n\nturn-instruction-session:0",
      turnId: "turn-instruction-session"
    });
    expect(recorded?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first.messages)).not.toContain(
      "turn-instruction-session:0"
    );
    expect(JSON.stringify(events)).not.toContain("turn-instruction-session:0");

    const reloaded = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      sessionStore: store,
      streamFn: async (_model, piContext) => _stream(piContext)
    });
    await reloaded.prompt("again");
    expect(resolutions).toBe(1);
    expect(reloaded.instructionSnapshot).toEqual(recorded);
  });

  test("blocks provider execution when dynamic instructions fail", async () => {
    const store = new InMemorySessionStore();
    let providerCalls = 0;
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        instructionEntries: [{
          kind: "dynamic",
          sourcePath: "instructions/failing.ts",
          definition: defineDynamicInstructions({
            events: {
              "turn.started": () => { throw new Error("resolution failed"); }
            }
          })
        }]
      }
    });
    expect(await _rejection(runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("missing-instruction-store")
    }))).toMatchObject({
      message: "Agent Projects with dynamic instructions require a Session Store"
    });
    expect(await _rejection(runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("failing-instructions"),
      sessionStore: store,
      streamFn: async (_model, piContext) => {
        providerCalls += 1;
        return _stream(piContext);
      }
    }))).toMatchObject({
      message: "resolution failed"
    });
    expect(providerCalls).toBe(0);
    expect(await store.load("failing-instructions")).toBeNull();
  });

  test("rolls back automatic state updates while preserving Pi tool-error recovery", async () => {
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [{
          ..._tool("echo"),
          async execute() {
            RUNTIME_COUNTER.update(() => ({ count: 9 }));
            throw new Error("tool failed");
          }
        }]
      }
    });
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("recoverable-tool-error"),
      sessionStore: store
    });

    await session.prompt("hello");

    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(session.messages[2]).toMatchObject({ isError: true });
    expect((await store.load("recoverable-tool-error"))?.snapshot.state)
      .toBeUndefined();

    const returnedErrorStore = new InMemorySessionStore();
    const returnedErrorRuntime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        tools: [{
          ..._tool("echo"),
          async execute() {
            return {
              content: [{ type: "text" as const, text: "known error" }],
              details: {},
              isError: true
            };
          }
        }]
      }
    });
    const returnedErrorSession = await returnedErrorRuntime.createSession({
      capabilityPolicy: _policy(),
      context: _context("returned-tool-error"),
      sessionStore: returnedErrorStore
    });
    await returnedErrorSession.prompt("hello");
    expect(returnedErrorSession.messages[2]).toMatchObject({ isError: true });
  });

  test("keeps manual placeholders internal and continues from resolved results", async () => {
    let executions = 0;
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: "manual-session",
      expectedVersion: null,
      mutations: [{
        type: "replaceState",
        values: {
          [RUNTIME_COUNTER.name]: {
            definitionVersion: 1,
            schemaFingerprint: "stale-schema",
            value: { count: 2 }
          }
        }
      }]
    });
    const tool: AgentTool = {
      name: "echo",
      label: "Echo",
      description: "Echo input.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      },
      async execute() {
        executions += 1;
        RUNTIME_COUNTER.update(current => ({ count: current.count + 1 }));
        return Promise.resolve({
          content: [{ type: "text", text: "should not execute" }],
          details: undefined
        });
      }
    };
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [tool]
      }
    });
    const persisted: AgentMessage[][] = [];
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("manual-session"),
      executionMode: "manual",
      sessionStore: store,
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        }
      }
    });
    const deferred: string[] = [];
    session.subscribe(event => {
      if (event.type === "tool_calls_deferred") {
        deferred.push(...event.calls.map(call => call.id));
      }
    });

    await session.prompt("hello");

    expect(executions).toBe(0);
    expect((await store.load("manual-session"))?.snapshot.state?.values[
      RUNTIME_COUNTER.name
    ]).toMatchObject({
      schemaFingerprint: "stale-schema",
      value: { count: 2 }
    });
    expect(deferred).toEqual(["call-one"]);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant"
    ]);

    await session.resolveToolResults([
      {
        role: "toolResult",
        toolCallId: "call-one",
        toolName: "echo",
        content: [{ type: "text", text: "echo:hello" }],
        isError: false,
        timestamp: Date.now()
      }
    ]);
    expect(persisted.at(-1)?.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult"
    ]);
    await session.continue();

    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect((await store.load("manual-session"))?.snapshot.state?.values[
      RUNTIME_COUNTER.name
    ]).toMatchObject({
      schemaFingerprint: "stale-schema",
      value: { count: 2 }
    });
  });

  test("executes one real tool batch without a second model turn in autoOnce", async () => {
    let executions = 0;
    const tool: AgentTool = {
      name: "echo",
      label: "Echo",
      description: "Echo input.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      },
      async execute() {
        executions += 1;
        return Promise.resolve({
          content: [{ type: "text", text: "echo:hello" }],
          details: undefined
        });
      }
    };
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] }
    });
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("auto-once-session"),
      executionMode: "autoOnce"
    });

    await session.prompt("hello");

    expect(executions).toBe(1);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult"
    ]);
  });

  test("keeps a host-deferred prepared tool pending during ReAct", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: _project()
    });
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("deferred-session"),
      executionMode: "react",
      extraTools: [
        {
          kind: "deferred",
          definition: {
            name: "echo",
            label: "Echo",
            description: "Echo input through the host.",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false
            }
          }
        }
      ]
    });
    const deferred: string[] = [];
    session.subscribe(event => {
      if (event.type === "tool_calls_deferred") {
        deferred.push(...event.calls.map(call => call.id));
      }
    });

    await session.prompt("hello");

    expect(deferred).toEqual(["call-one"]);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant"
    ]);
  });

  test("does not commit automatic step state when a sibling result is deferred", async () => {
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [{
          ..._tool("remember"),
          async execute() {
            RUNTIME_COUNTER.update(() => ({ count: 4 }));
            return {
              content: [{ type: "text" as const, text: "remembered" }],
              details: {}
            };
          }
        }]
      }
    });
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("mixed-deferred-session"),
      extraTools: [{
        kind: "deferred",
        definition: {
          name: "host_action",
          label: "Host action",
          description: "Wait for the Host.",
          parameters: { type: "object", properties: {} }
        }
      }],
      sessionStore: store,
      streamFn: _mixedToolStream
    });

    await session.prompt("hello");

    expect((await store.load("mixed-deferred-session"))?.snapshot.state)
      .toBeUndefined();
  });

  test("blocks unavailable defaults and model requests outside Agent source", async () => {
    const project = {
      ..._project(),
      definition: {
        model: { provider: "missing", id: "missing-model" },
        reasoning: "high" as const
      }
    };
    const runtime = new AgentRuntime({ models: _reactModels(), project });

    expect(runtime.defaultModel).toEqual({
      selector: { provider: "missing", id: "missing-model" },
      available: false
    });
    try {
      await runtime.createSession({
        capabilityPolicy: _policy(),
        context: _context("missing-session")
      });
      throw new Error("Expected the unavailable default to reject.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AgentRuntimeModelUnavailableError",
        selector: { provider: "missing", id: "missing-model" }
      });
    }
    expect(await _rejection(runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("override-session"),
      model: { provider: "fake", id: "fake-model" }
    }))).toMatchObject({
      message: "Agent source denies model request: fake/fake-model"
    });
  });

  test("uses Eve fallback on dynamic model failure and denies policy escape", async () => {
    const fallback = defineDynamicModel({
      fallback: "fake/fake-model",
      events: {
        "turn.started": () => { throw new Error("resolver failed"); }
      }
    });
    const fallbackRuntime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        definition: {
          model: { provider: "fake", id: "fake-model" },
          dynamicModel: fallback,
          reasoning: "high"
        }
      }
    });
    const fallbackSession = await fallbackRuntime.createSession({
      capabilityPolicy: _policy(),
      context: _context("dynamic-fallback"),
      sessionStore: new InMemorySessionStore()
    });
    expect(fallbackSession.capabilitySnapshot).toMatchObject({
      model: { provider: "fake", id: "fake-model" }
    });

    const escaping = defineDynamicModel({
      fallback: "fake/fake-model",
      events: { "turn.started": () => "missing/missing-model" }
    });
    const escapingRuntime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        definition: {
          model: { provider: "fake", id: "fake-model" },
          dynamicModel: escaping,
          reasoning: "high"
        }
      }
    });
    expect(await _rejection(escapingRuntime.createSession({
      capabilityPolicy: {
        ..._policy(),
        models: [{ provider: "fake", id: "fake-model" }]
      },
      context: _context("dynamic-policy-denial"),
      sessionStore: new InMemorySessionStore()
    }))).toMatchObject({ message: "Host policy denies model: missing/missing-model" });
  });

  test("requires a Session Store for dynamic capability resolution", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        definition: {
          model: { provider: "fake", id: "fake-model" },
          dynamicModel: defineDynamicModel({
            fallback: "fake/fake-model",
            events: { "turn.started": () => "fake/fake-model" }
          })
        }
      }
    });

    expect(await _rejection(runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("dynamic-without-store")
    }))).toMatchObject({
      message: "Agent Projects with dynamic capabilities require a Session Store"
    });
  });

  test("rejects model options outside source authority or intrinsic bounds", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        definition: {
          model: { provider: "fake", id: "fake-model" },
          modelOptions: { maxRetries: 1 }
        }
      }
    });
    const policy = {
      ..._policy(),
      modelOptions: {
        maxRetries: { min: -10, max: 10 },
        temperature: { min: -10, max: 10 }
      }
    };

    expect(await _rejection(runtime.createSession({
      capabilityPolicy: policy,
      context: _context("unauthorized-option"),
      modelOptions: { temperature: 0.4 }
    }))).toMatchObject({
      message: "Agent source denies model option request: temperature"
    });
    expect(await _rejection(runtime.createSession({
      capabilityPolicy: policy,
      context: _context("invalid-option"),
      modelOptions: { maxRetries: -1 }
    }))).toMatchObject({
      message: "Invalid model option value: maxRetries"
    });
  });

  test("resolves manual capabilities without exposing Session state", async () => {
    let modelSawState = false;
    let toolsSawState = false;
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: "manual-capabilities",
      expectedVersion: null,
      mutations: [{
        type: "replaceState",
        values: {
          [RUNTIME_COUNTER.name]: {
            definitionVersion: RUNTIME_COUNTER.version,
            schemaFingerprint: "runtime-counter-v1",
            value: { count: 2 }
          }
        }
      }]
    });
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        definition: {
          model: { provider: "fake", id: "fake-model" },
          dynamicModel: defineDynamicModel({
            fallback: "fake/fake-model",
            events: {
              "turn.started": () => {
                RUNTIME_COUNTER.get();
                modelSawState = true;
                return {
                  model: "fake/fake-model",
                  modelOptions: { temperature: 0.3 }
                };
              }
            }
          })
        },
        dynamicToolResolvers: [{
          contributionId: "tool-resolver:tools/state.ts",
          definition: defineDynamicTools({
            events: {
              "turn.started": () => {
                RUNTIME_COUNTER.get();
                toolsSawState = true;
                return null;
              }
            }
          }),
          sourcePath: "tools/state.ts",
          steps: {}
        }],
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }]
      }
    });
    const session = await runtime.createSession({
      capabilityPolicy: {
        ..._policy(),
        toolContributions: [
          ..._policy().toolContributions,
          "tool-resolver:tools/state.ts"
        ]
      },
      context: _context("manual-capabilities"),
      executionMode: "manual",
      sessionStore: store
    });

    expect(modelSawState).toBe(false);
    expect(toolsSawState).toBe(false);
    expect(session.capabilitySnapshot).toMatchObject({
      modelOptions: {},
      tools: []
    });
  });

  test("inherits authored reasoning and rejects an unauthorized default", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: _project()
    });

    const inherited = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("inherited-session")
    });
    const providerDefault = _rejection(runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("provider-default-session"),
      reasoning: undefined
    }));

    expect(inherited.reasoning).toBe("high");
    expect(await providerDefault).toMatchObject({
      message: "Agent source denies reasoning request: undefined"
    });
  });

  test("rejects non-plain project tool definitions instead of sharing them", () => {
    class StatefulTool implements AgentTool {
      name = "stateful";
      label = "Stateful";
      description = "Stateful class tool.";
      parameters = { type: "object" as const, properties: {} };

      async execute() {
        return Promise.resolve({
          content: [{ type: "text" as const, text: "done" }],
          details: {}
        });
      }
    }

    expect(
      () =>
        new AgentRuntime({
          models: _models(),
          project: { ..._project(), tools: [new StatefulTool()] }
        })
    ).toThrow("plain data objects");
  });
});

const RUNTIME_COUNTER = defineState({
  name: "test.runtime-counter",
  version: 1,
  schema: Type.Object({ count: Type.Number() }),
  initial: { count: 0 }
});

function _context(id: string) {
  const principal = {
    issuer: "test",
    principalId: "runtime-test",
    principalType: "runtime" as const
  };
  return {
    id,
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: `turn-${id}`, sequence: 1 }
  };
}

function _policy() {
  return {
    connectionContributions: [],
    modelOptions: {},
    models: [
      { provider: "fake", id: "fake-model" },
      { provider: "missing", id: "missing-model" }
    ],
    reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
    toolContributions: [
      "host-tool:echo",
      "host-tool:host_action",
      "host-tool:remember",
      "tool:echo",
      "tool:remember"
    ]
  };
}

function _project(): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: {
      model: { provider: "fake", id: "fake-model" },
      reasoning: "high"
    },
    instructions: "Test agent.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-one"
  };
}

function _tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async () =>
      Promise.resolve({ content: [{ type: "text", text: "" }], details: {} })
  };
}

function _models(): Models {
  return {
    getModel(provider: string, id: string) {
      return provider === "fake" && id === "fake-model"
        ? { provider, id }
        : undefined;
    }
  } as unknown as Models;
}

function _reactModels(): Models {
  const model: Model<"fake"> = {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
  const api = {
    stream: (_model: Model<Api>, context: Context) => _stream(context),
    streamSimple: (_model: Model<Api>, context: Context) => _stream(context)
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

function _stream(context: Context) {
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

function _delegationStream(context: Context) {
  const stream = createAssistantMessageEventStream();
  const isChild = context.systemPrompt === "Child only.";
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const content: AssistantMessage["content"] = isChild
    ? [{ type: "text", text: "child result" }]
    : hasToolResult
      ? [{ type: "text", text: "parent result" }]
      : [{
        type: "toolCall",
        id: "call-researcher",
        name: "researcher",
        arguments: { message: "bounded task" }
      }];
  const stopReason = isChild || hasToolResult ? "stop" : "toolUse";
  const message: AssistantMessage = {
    role: "assistant",
    content,
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
    stopReason,
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: stopReason, message });
  });
  return stream;
}

function _approvalDelegationStream(context: Context) {
  const stream = createAssistantMessageEventStream();
  const isChild = context.systemPrompt === "Child approval.";
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const content: AssistantMessage["content"] = isChild
    ? hasToolResult
      ? [{ type: "text", text: "child approved result" }]
      : [{
        type: "toolCall",
        id: "call-approval-action",
        name: "approval_action",
        arguments: {}
      }]
    : hasToolResult
      ? [{ type: "text", text: "parent handled child failure" }]
      : [{
        type: "toolCall",
        id: "call-approver",
        name: "approver",
        arguments: { message: "approve this" }
      }];
  const message: AssistantMessage = {
    role: "assistant",
    content,
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

function _mixedToolStream(_model: Model<Api>, context: Context) {
  const stream = createAssistantMessageEventStream();
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    role: "assistant",
    content: hasToolResult ? [{ type: "text", text: "done" }] : [
      {
        type: "toolCall",
        id: "call-remember",
        name: "remember",
        arguments: {}
      },
      {
        type: "toolCall",
        id: "call-host",
        name: "host_action",
        arguments: {}
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
  throw new Error("Expected operation to reject");
}
