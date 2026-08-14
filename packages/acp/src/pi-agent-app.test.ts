import { expect, test } from "bun:test";

import type { AgentMessage, LogItem } from "@earendil-works/pi-agent-core";
import type { PiSessionSnapshot } from "@llm-space/pi-runtime";

import {
  LLM_SPACE_ACP_METHODS,
  PROTOCOL_VERSION,
  client,
  createPiAcpAgent,
  methods,
  type PiAcpContinueRequest,
  type PiAcpDebugResponse,
  type PiAcpMutationRequest,
  type PiAcpSessionBackend,
  type PiAcpSnapshotRequest,
  type PiAcpStepRequest,
  type UpdateSessionNotification,
} from "./index";

test("serves ACP v2 lifecycle and negotiated debugger methods in process", async () => {
  const backend = new FakePiAcpSessionBackend();
  const updates: UpdateSessionNotification[] = [];
  const app = createPiAcpAgent({ backend, version: "4.0.1", now: () => 1 });
  const acpClient = client({ name: "test-client" }).onNotification(
    methods.client.session.update,
    ({ params }) => {
      updates.push(params);
    }
  );

  await acpClient.connectWith(app, async (agent) => {
    const initialized = await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "test-client", version: "1" },
    });
    expect(initialized.protocolVersion).toBe(2);
    expect(initialized.capabilities?._meta?.["llm-space.dev"]).toBeDefined();

    const created = await agent.request(methods.agent.session.new, {
      cwd: "/workspace",
    });
    expect(created).toMatchObject({
      sessionId: "session-1",
      _meta: { "llm-space.dev": { cursor: 0 } },
    });

    const snapshot = await agent.request<
      PiAcpDebugResponse,
      PiAcpSnapshotRequest
    >(LLM_SPACE_ACP_METHODS.snapshot, {
      sessionId: "session-1",
      afterSeq: 0,
    });
    expect(snapshot.snapshot.status).toBe("paused");
    expect(snapshot.updates.at(-1)).toMatchObject({
      sessionUpdate: "state_update",
      state: "requires_action",
    });

    const stepRequest = {
      sessionId: "session-1",
      afterSeq: snapshot.cursor,
      commandId: "command-step-1",
      expectedActionId: "run-1:model:1",
      kind: "model" as const,
    };
    const stepped = await agent.request<PiAcpDebugResponse, PiAcpStepRequest>(
      LLM_SPACE_ACP_METHODS.step,
      stepRequest
    );
    expect(stepped.snapshot.status).toBe("completed");
    expect(backend.stepCalls).toBe(1);
    expect(updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "end_turn",
    });
    expect(
      await agent.request<PiAcpDebugResponse, PiAcpStepRequest>(
        LLM_SPACE_ACP_METHODS.step,
        stepRequest
      )
    ).toEqual(stepped);
    expect(backend.stepCalls).toBe(1);

    const continued = await agent.request<
      PiAcpDebugResponse,
      PiAcpContinueRequest
    >(LLM_SPACE_ACP_METHODS.continue, {
      sessionId: "session-1",
      afterSeq: stepped.cursor,
      commandId: "command-continue-1",
    });
    expect(continued.snapshot.status).toBe("completed");
    expect(backend.continueCalls).toBe(1);
  });
});

test("reconciles debugger command retries across ACP app restarts", async () => {
  const backend = new FakePiAcpSessionBackend();
  const request = {
    sessionId: "session-1",
    afterSeq: 0,
    commandId: "durable-step-command",
    expectedActionId: "run-1:model:1",
    kind: "model" as const,
  };
  let committed!: PiAcpDebugResponse;
  await client({ name: "first-client" }).connectWith(
    createPiAcpAgent({ backend, version: "4.0.1" }),
    async (agent) => {
      await agent.request(methods.agent.session.new, { cwd: "/workspace" });
      committed = await agent.request<PiAcpDebugResponse, PiAcpStepRequest>(
        LLM_SPACE_ACP_METHODS.step,
        request
      );
    }
  );

  await client({ name: "restarted-client" }).connectWith(
    createPiAcpAgent({ backend, version: "4.0.1" }),
    async (agent) => {
      expect(
        await agent.request<PiAcpDebugResponse, PiAcpStepRequest>(
          LLM_SPACE_ACP_METHODS.step,
          request
        )
      ).toEqual(committed);
      expect(backend.stepCalls).toBe(1);
      expect(
        await _rejectionOf(
          agent.request<PiAcpDebugResponse, PiAcpStepRequest>(
            LLM_SPACE_ACP_METHODS.step,
            {
              ...request,
              expectedActionId: "another-action",
            }
          )
        )
      ).toBeDefined();
    }
  );
});

test("coalesces concurrent debugger retries and retries failed commands", async () => {
  const backend = new FakePiAcpSessionBackend();
  const app = createPiAcpAgent({ backend, version: "4.0.1" });
  const request = {
    sessionId: "session-1",
    afterSeq: 0,
    commandId: "concurrent-step-command",
    expectedActionId: "run-1:model:1",
    kind: "model" as const,
  };

  await client({ name: "concurrent-client" }).connectWith(
    app,
    async (agent) => {
      await agent.request(methods.agent.session.new, { cwd: "/workspace" });
      const release = backend.holdNextStep();
      const first = agent.request(LLM_SPACE_ACP_METHODS.step, request);
      await backend.waitForStep();
      const second = agent.request(LLM_SPACE_ACP_METHODS.step, request);
      release();
      const [left, right] = await Promise.all([first, second]);
      expect(right).toEqual(left);
      expect(backend.stepInvocations).toBe(1);
      expect(backend.stepCalls).toBe(1);

      backend.resetPaused();
      backend.failNextStep();
      const retryable = { ...request, commandId: "retryable-command" };
      expect(
        await _rejectionOf(agent.request(LLM_SPACE_ACP_METHODS.step, retryable))
      ).toBeDefined();
      expect(
        await agent.request(LLM_SPACE_ACP_METHODS.step, retryable)
      ).toMatchObject({ snapshot: { status: "completed" } });
      expect(backend.stepCalls).toBe(3);
    }
  );
});

test("accepts standard v2 prompt before background Pi execution completes", async () => {
  const backend = new FakePiAcpSessionBackend();
  const updates: UpdateSessionNotification[] = [];
  const app = createPiAcpAgent({ backend, version: "4.0.1", now: () => 1 });
  const acpClient = client({ name: "test-client" }).onNotification(
    methods.client.session.update,
    ({ params }) => {
      updates.push(params);
    }
  );

  await acpClient.connectWith(app, async (agent) => {
    await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "test-client", version: "1" },
    });
    await agent.request(methods.agent.session.new, { cwd: "/workspace" });
    const accepted = await agent.request(methods.agent.session.prompt, {
      sessionId: "session-1",
      prompt: [{ type: "text", text: "Run" }],
    });
    expect(accepted).toEqual({
      _meta: { "llm-space.dev": { accepted: true } },
    });
    expect(backend.promptCalls).toEqual([
      [{ role: "user", content: "Run", timestamp: 1 }],
    ]);
    expect(updates[0]?.update).toEqual({
      sessionUpdate: "state_update",
      state: "running",
    });

    backend.finishPrompt();
    for (
      let attempt = 0;
      attempt < 20 &&
      !(
        updates.at(-1)?.update.sessionUpdate === "state_update" &&
        (updates.at(-1)!.update as { state?: string }).state === "idle"
      );
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "end_turn",
    });
  });
});

test("reconnects after an ACP transport gap from the last Pi cursor", async () => {
  const backend = new FakePiAcpSessionBackend();
  const app = createPiAcpAgent({ backend, version: "4.0.1", now: () => 1 });
  let cursor = 0;

  await client({ name: "first-client" }).connectWith(app, async (agent) => {
    await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "first-client", version: "1" },
    });
    await agent.request(methods.agent.session.new, { cwd: "/workspace" });
    const before = await agent.request<
      PiAcpDebugResponse,
      PiAcpSnapshotRequest
    >(LLM_SPACE_ACP_METHODS.snapshot, {
      sessionId: "session-1",
      afterSeq: 0,
    });
    cursor = before.cursor;
  });

  await (backend as PiAcpSessionBackend).step({
    sessionId: "session-1",
    afterSeq: cursor,
    commandId: "command-disconnected-step",
    expectedActionId: "run-1:model:1",
    kind: "model",
  });

  await client({ name: "second-client" }).connectWith(app, async (agent) => {
    await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "second-client", version: "1" },
    });
    const replayed = await agent.request<
      PiAcpDebugResponse,
      PiAcpSnapshotRequest
    >(LLM_SPACE_ACP_METHODS.snapshot, {
      sessionId: "session-1",
      afterSeq: cursor,
    });
    expect(replayed.cursor).toBe(1);
    expect(replayed.updates).toContainEqual({
      sessionUpdate: "agent_message",
      messageId: "assistant-entry",
      content: [{ type: "text", text: "Done" }],
    });
    expect(replayed.snapshot.status).toBe("completed");
  });
});

test("cancel keeps the durable aborted outcome authoritative over background prompt", async () => {
  const backend = new FakePiAcpSessionBackend();
  const updates: UpdateSessionNotification[] = [];
  const app = createPiAcpAgent({ backend, version: "4.0.1", now: () => 1 });
  const acpClient = client({ name: "cancel-client" }).onNotification(
    methods.client.session.update,
    ({ params }) => {
      updates.push(params);
    }
  );

  await acpClient.connectWith(app, async (agent) => {
    await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "cancel-client", version: "1" },
    });
    await agent.request(methods.agent.session.new, { cwd: "/workspace" });
    await agent.request(methods.agent.session.prompt, {
      sessionId: "session-1",
      prompt: [{ type: "text", text: "Cancel me" }],
    });
    await agent.notify(methods.agent.session.cancel, {
      sessionId: "session-1",
    });

    const inspected = await agent.request<
      PiAcpDebugResponse,
      PiAcpSnapshotRequest
    >(LLM_SPACE_ACP_METHODS.snapshot, {
      sessionId: "session-1",
      afterSeq: 0,
    });
    expect(inspected.snapshot.status).toBe("aborted");
    expect(updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "cancelled",
    });
    expect(
      updates.some(
        ({ update }) =>
          update.sessionUpdate === "state_update" &&
          (
            (update._meta as Record<string, unknown> | null | undefined)?.[
              "llm-space.dev"
            ] as { status?: string } | undefined
          )?.status === "failed"
      )
    ).toBe(false);
  });
});

test("continues an accepted Pi prompt after transport disconnect and replays it", async () => {
  const backend = new FakePiAcpSessionBackend();
  const app = createPiAcpAgent({ backend, version: "4.0.1", now: () => 1 });

  await client({ name: "disconnecting-client" }).connectWith(
    app,
    async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        info: { name: "disconnecting-client", version: "1" },
      });
      await agent.request(methods.agent.session.new, { cwd: "/workspace" });
      await agent.request(methods.agent.session.prompt, {
        sessionId: "session-1",
        prompt: [{ type: "text", text: "Finish while disconnected" }],
      });
    }
  );

  backend.finishPrompt();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      (await backend.inspect({ afterSeq: 0 })).snapshot.status === "completed"
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await client({ name: "reconnecting-client" }).connectWith(
    app,
    async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        info: { name: "reconnecting-client", version: "1" },
      });
      const replayed = await agent.request<
        PiAcpDebugResponse,
        PiAcpSnapshotRequest
      >(LLM_SPACE_ACP_METHODS.snapshot, {
        sessionId: "session-1",
        afterSeq: 0,
      });
      expect(replayed.snapshot.status).toBe("completed");
      expect(replayed.updates).toContainEqual({
        sessionUpdate: "agent_message",
        messageId: "assistant-entry",
        content: [{ type: "text", text: "Done" }],
      });
    }
  );
});

class FakePiAcpSessionBackend implements PiAcpSessionBackend {
  stepCalls = 0;
  stepInvocations = 0;
  continueCalls = 0;
  promptCalls: AgentMessage[][] = [];
  private _failStep = false;
  private _stepStarted!: () => void;
  private _stepStartedPromise = Promise.resolve();
  private _stepRelease?: Promise<void>;
  private _releaseStep?: () => void;
  private readonly _debugCommands = new Map<
    string,
    Map<string, { fingerprint: string; response: Promise<PiSessionSnapshot> }>
  >();
  private _promptResolve!: () => void;
  private readonly _promptSettled = new Promise<void>((resolve) => {
    this._promptResolve = resolve;
  });
  private _snapshot = pausedSnapshot();
  private _log: LogItem[] = [];

  create(): Promise<PiSessionSnapshot> {
    this._snapshot = pausedSnapshot();
    this._log = [];
    return Promise.resolve(this._snapshot);
  }

  list() {
    return Promise.resolve({
      sessions: [{ sessionId: "session-1", cwd: "/workspace" }],
    });
  }

  inspect(input: { afterSeq?: number }) {
    const items = this._log.filter(
      (item) => input.afterSeq === undefined || item.seq > input.afterSeq
    );
    return Promise.resolve({
      fromCursor: Math.min(this._snapshot.cursor, input.afterSeq ?? 0),
      cursor: items.at(-1)?.seq ?? this._snapshot.cursor,
      items,
      snapshot: this._snapshot,
    });
  }

  async prompt(input: { messages: AgentMessage[]; signal: AbortSignal }) {
    this.promptCalls.push(input.messages);
    await Promise.race([
      this._promptSettled,
      new Promise<never>((_, reject) => {
        input.signal.addEventListener(
          "abort",
          () =>
            reject(
              input.signal.reason instanceof Error
                ? input.signal.reason
                : new Error("The fake prompt was aborted.")
            ),
          { once: true }
        );
      }),
    ]);
    this._complete();
    return this._snapshot;
  }

  step(input: PiAcpStepRequest): Promise<PiSessionSnapshot> {
    this.stepInvocations += 1;
    return this._runDebugCommand("step", input, async () => {
      this.stepCalls += 1;
      this._stepStarted?.();
      await this._stepRelease;
      this._stepRelease = undefined;
      this._releaseStep = undefined;
      if (this._failStep) {
        this._failStep = false;
        throw new Error("fake step failure");
      }
      this._complete();
      return this._snapshot;
    });
  }

  continue(input: PiAcpContinueRequest): Promise<PiSessionSnapshot> {
    return this._runDebugCommand("continue", input, () => {
      this.continueCalls += 1;
      return Promise.resolve(this._snapshot);
    });
  }

  abort(): Promise<PiSessionSnapshot> {
    this._snapshot = {
      ...this._snapshot,
      status: "aborted",
      nextAction: undefined,
    };
    return Promise.resolve(this._snapshot);
  }

  closeSession(): Promise<void> {
    return Promise.resolve();
  }

  finishPrompt(): void {
    this._promptResolve();
  }

  holdNextStep(): () => void {
    this._stepStartedPromise = new Promise<void>((resolve) => {
      this._stepStarted = resolve;
    });
    this._stepRelease = new Promise<void>((resolve) => {
      this._releaseStep = resolve;
    });
    return () => this._releaseStep?.();
  }

  waitForStep(): Promise<void> {
    return this._stepStartedPromise;
  }

  failNextStep(): void {
    this._failStep = true;
  }

  resetPaused(): void {
    this._snapshot = pausedSnapshot();
    this._log = [];
  }

  private async _runDebugCommand(
    method: string,
    input: PiAcpMutationRequest,
    execute: () => Promise<PiSessionSnapshot>
  ): Promise<PiSessionSnapshot> {
    let sessionCommands = this._debugCommands.get(input.sessionId);
    const fingerprint = JSON.stringify({ method, input });
    const existing = sessionCommands?.get(input.commandId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error(
          `Command "${input.commandId}" was already used with other input.`
        );
      }
      return existing.response;
    }
    if (sessionCommands === undefined) {
      sessionCommands = new Map();
      this._debugCommands.set(input.sessionId, sessionCommands);
    }
    const response = execute();
    sessionCommands.set(input.commandId, { fingerprint, response });
    try {
      return await response;
    } catch (error) {
      if (sessionCommands.get(input.commandId)?.response === response) {
        sessionCommands.delete(input.commandId);
      }
      throw error;
    }
  }

  private _complete(): void {
    this._log = [
      {
        kind: "entry",
        seq: 1,
        entry: {
          type: "message",
          id: "assistant-entry",
          seq: 1,
          parentId: null,
          timestamp: 1,
          message: assistantMessage(),
        },
      },
    ];
    this._snapshot = {
      ...this._snapshot,
      cursor: 1,
      status: "completed",
      leafId: "assistant-entry",
      messages: [assistantMessage()],
      nextAction: undefined,
    };
  }
}

function pausedSnapshot(): PiSessionSnapshot {
  return {
    cursor: 0,
    sessionId: "session-1",
    lane: "main",
    operationId: "run-1",
    status: "paused",
    messageEntries: [],
    messages: [],
    leafId: null,
    nextAction: { id: "run-1:model:1", kind: "model", attempt: 1 },
  };
}

function assistantMessage(): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "Done" }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

/** Captures a required rejection so Bun tests await the actual async outcome. */
async function _rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}
