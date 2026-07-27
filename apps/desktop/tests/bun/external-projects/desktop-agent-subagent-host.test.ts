import { describe, expect, test } from "bun:test";

import type { AssistantMessage, Models } from "@earendil-works/pi-ai";
import type {
  AgentSubagentRunStart,
  CompiledAgentProjectSnapshot
} from "@llm-space/runtime/node";

import {
  createDesktopAgentSubagentHost,
  type DesktopAgentSubagentRecordAdapter
} from "../../../src/bun/external-projects/desktop-agent-subagent-host";

import type {
  ExternalAgentProjectSubagentRun
} from "../../../src/shared/external-agent-project";

describe("createDesktopAgentSubagentHost", () => {
  test("persists lineage first and backfills an existing child terminal", async () => {
    const records = _records();
    const start = _start();
    const host = createDesktopAgentSubagentHost({
      models: _models(),
      records,
      resolveProject: async () => _project()
    });

    const first = await host.prepare(start, _context());
    const persisted = await records.load(start.child);

    expect(persisted).toMatchObject({
      artifactFingerprint: "child-artifact",
      child: start.child,
      description: "Research one question.",
      limits: { maxModelCallsPerRun: 25 },
      message: "Find the answer.",
      parent: start.parent,
      sandbox: { mode: "shared", revalidationFingerprint: "sandbox-one" },
      status: "running",
      subagentId: "researcher"
    });
    expect(first.resume).toEqual({ type: "prompt" });
    await first.persistence?.replaceMessages([_assistant("child result")]);
    const current = await first.sessionStore?.load(start.child.sessionId);
    if (!current || !first.sessionStore) {
      throw new Error("Expected child Session Store");
    }
    await first.sessionStore.commit({
      sessionId: start.child.sessionId,
      expectedVersion: current.version,
      mutations: [{
        type: "transitionRun",
        runId: start.child.runId,
        to: "completed"
      }]
    });

    const recovered = await host.prepare(start, _context());

    expect(recovered.resume).toEqual({
      type: "terminal",
      terminal: { status: "completed", result: "child result" }
    });
    expect((await records.load(start.child))?.terminal).toEqual({
      status: "completed",
      result: "child result"
    });
  });

  test("keeps a pending child wait parked across Host recreation", async () => {
    const records = _records();
    const start = _start();
    const firstHost = createDesktopAgentSubagentHost({
      models: _models(),
      records,
      resolveProject: async () => _project()
    });
    const first = await firstHost.prepare(start, _context());
    const current = await first.sessionStore?.load(start.child.sessionId);
    if (!current || !first.sessionStore) {
      throw new Error("Expected child Session Store");
    }
    await first.sessionStore.commit({
      sessionId: start.child.sessionId,
      expectedVersion: current.version,
      mutations: [
        { type: "transitionRun", runId: start.child.runId, to: "runningTools" },
        {
          type: "transitionRun",
          runId: start.child.runId,
          to: "waitingForToolResults"
        }
      ]
    });
    const restartedHost = createDesktopAgentSubagentHost({
      models: _models(),
      records,
      resolveProject: async () => _project()
    });

    const recovered = await restartedHost.prepare(start, _context());

    expect(recovered.resume).toEqual({
      type: "park",
      wait: { state: "waitingForToolResults" }
    });
  });
});

function _records(): DesktopAgentSubagentRecordAdapter {
  const values = new Map<string, ExternalAgentProjectSubagentRun>();
  const key = (identity: { runId: string; sessionId: string; }) =>
    `${identity.sessionId}:${identity.runId}`;
  return {
    async create(identity, create) {
      const existing = values.get(key(identity));
      if (existing) { return { created: false, record: existing }; }
      const record = await create();
      values.set(key(identity), record);
      return { created: true, record };
    },
    async load(identity) {
      return values.get(key(identity)) ?? null;
    },
    async update(identity, update) {
      const current = values.get(key(identity));
      if (!current) { throw new Error("Missing record"); }
      const next = await update(current);
      values.set(key(identity), next);
      return next;
    }
  };
}

function _start(): AgentSubagentRunStart {
  return {
    child: { runId: "child-run", sessionId: "child-session" },
    message: "Find the answer.",
    parent: {
      runId: "parent-run",
      sessionId: "parent-session",
      toolCallId: "call-researcher"
    },
    sandbox: {
      mode: "shared",
      revalidationFingerprint: "sandbox-one"
    },
    subagent: {
      artifactFingerprint: "child-artifact",
      description: "Research one question.",
      id: "researcher"
    }
  };
}

function _context() {
  const principal = {
    issuer: "desktop-test",
    principalId: "local-user",
    principalType: "user" as const
  };
  return {
    id: "child-session",
    auth: { current: principal, initiator: principal },
    channel: { kind: "desktop" },
    turn: { id: "child-run", sequence: 1 }
  };
}

function _project(): CompiledAgentProjectSnapshot {
  return {
    root: "/agent/subagents/researcher",
    definition: {
      description: "Research one question.",
      limits: { maxModelCallsPerRun: 25 },
      model: { provider: "fake", id: "fake-model" }
    },
    instructions: "Research.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "child-snapshot",
    artifact: {
      schemaVersion: 1,
      fingerprint: "child-artifact",
      fingerprints: {} as never
    }
  };
}

function _models(): Models {
  const model = { provider: "fake", id: "fake-model" };
  return {
    getModel: () => model,
    getModels: () => [model]
  } as unknown as Models;
}

function _assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
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
    stopReason: "stop",
    timestamp: Date.now()
  };
}
