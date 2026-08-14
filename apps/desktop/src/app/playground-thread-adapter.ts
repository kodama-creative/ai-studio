import {
  LLM_SPACE_ACP_METHODS,
  methods,
  type ClientConnection,
  type ContentBlock,
  type PiAcpDebugResponse,
  type PiAcpSnapshotRequest,
  type PiAcpStepRequest,
  type PiAcpContinueRequest,
  type UpdateSessionNotification,
} from "@llm-space/acp";
import type { Message, Thread } from "@llm-space/core";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
  type Playground,
  type SavePlaygroundInput,
} from "@llm-space/studio";
import type { ExternalThreadExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type { OpenDesktopAcpConnectionOptions } from "@/client/acp-client";
import type { PlaygroundClient } from "@/client/playground-client";

export interface PlaygroundThreadRuntimeOptions {
  readonly client: PlaygroundClient;
  readonly playgroundId: string;
  readonly getPlayground: () => Playground;
  readonly onPlayground: (playground: Playground) => void;
  readonly beforeExecute?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
  readonly openAcpConnection?: (
    options: OpenDesktopAcpConnectionOptions
  ) => Promise<ClientConnection>;
}

/** Presents a durable Studio Playground through the editor-only Thread model. */
export function playgroundToEditorThread(playground: Playground): Thread {
  return playgroundToThread(playground);
}

/** Adapts editor controls to ACP prompt, Step, Continue, and Cancel methods. */
export function createPlaygroundThreadExecutionRuntime(
  options: PlaygroundThreadRuntimeOptions
): ExternalThreadExecutionRuntime {
  return {
    async *execute(request) {
      await options.beforeExecute?.();
      const updates = new SessionUpdateWaiter();
      const connection = await (
        options.openAcpConnection ?? _openDesktopAcpConnection
      )({ onSessionUpdate: (update) => updates.accept(update) });
      let playground = options.getPlayground();
      try {
        if (playground.operationId === undefined) {
          playground = await options.client.save(
            options.playgroundId,
            _document(request.thread, playground)
          );
          options.onPlayground(playground);
          const fromMessageId =
            request.fromMessageId ??
            request.thread.context?.messages?.at(-1)?.id;
          if (fromMessageId === undefined) {
            throw new Error(
              "A Playground operation requires at least one Message."
            );
          }
          const message = request.thread.context?.messages?.find(
            (candidate) => candidate.id === fromMessageId
          );
          if (message?.role !== "user") {
            throw new Error(
              `Playground operation input "${fromMessageId}" must be a user Message.`
            );
          }
          const stopped = updates.waitForStop(playground.sessionId);
          await connection.agent.request(methods.agent.session.prompt, {
            sessionId: playground.sessionId,
            prompt: _promptContent(message),
            _meta: {
              "llm-space.dev": {
                fromMessageId,
                mode: request.reactLoop ? "continue" : "step",
              },
            },
          });
          await stopped;
        } else if (request.reactLoop) {
          const snapshot = await _snapshot(connection, playground.sessionId);
          await connection.agent.request<
            PiAcpDebugResponse,
            PiAcpContinueRequest
          >(LLM_SPACE_ACP_METHODS.continue, {
            sessionId: playground.sessionId,
            afterSeq: snapshot.cursor,
            commandId: crypto.randomUUID(),
          });
        } else {
          await _stepCurrent(connection, playground.sessionId);
        }

        if (!request.reactLoop && request.autoRunTools) {
          while (true) {
            const snapshot = await _snapshot(connection, playground.sessionId);
            if (snapshot.snapshot.nextAction?.kind !== "tool") break;
            await _stepCurrent(connection, playground.sessionId, snapshot);
          }
        }
        yield* _refresh(options);
      } finally {
        if (request.signal.aborted) {
          await connection.agent.notify(methods.agent.session.cancel, {
            sessionId: playground.sessionId,
          });
        }
        connection.close();
        await options.onSettled?.();
      }
    },

    async *executeToolCall(request) {
      await options.beforeExecute?.();
      const playground = options.getPlayground();
      if (playground.operationId === undefined) {
        throw new Error(
          "The tool call does not belong to an active operation."
        );
      }
      const connection = await (
        options.openAcpConnection ?? _openDesktopAcpConnection
      )({});
      try {
        const snapshot = await _snapshot(connection, playground.sessionId);
        const action = snapshot.snapshot.nextAction;
        if (
          action?.kind !== "tool" ||
          action.toolCallId !== request.toolCallId
        ) {
          throw new Error(
            `Tool call "${request.toolCallId}" is not the current Pi action.`
          );
        }
        yield { type: "tool.started", toolCallId: request.toolCallId };
        await _stepCurrent(connection, playground.sessionId, snapshot);
        yield { type: "tool.completed", toolCallId: request.toolCallId };
        yield* _refresh(options);
      } finally {
        if (request.signal.aborted) {
          await connection.agent.notify(methods.agent.session.cancel, {
            sessionId: playground.sessionId,
          });
        }
        connection.close();
        await options.onSettled?.();
      }
    },
  };
}

/** Preserves Studio-owned state while splitting the editor document. */
function _document(
  thread: Thread,
  playground: Playground
): SavePlaygroundInput {
  return threadToPlaygroundDocument(thread, playground.conversation.state);
}

/** Converts the selected editor user message to standard ACP content blocks. */
function _promptContent(
  message: Extract<Message, { role: "user" }>
): ContentBlock[] {
  const content = message.content.flatMap((item) =>
    item.type === "text" ? [{ type: "text" as const, text: item.text }] : []
  );
  if (content.length === 0) {
    throw new Error("ACP Playground prompts currently require text content.");
  }
  return content;
}

/** Reads the committed debugger projection at the current Pi cursor. */
function _snapshot(
  connection: ClientConnection,
  sessionId: string
): Promise<PiAcpDebugResponse> {
  return connection.agent.request<PiAcpDebugResponse, PiAcpSnapshotRequest>(
    LLM_SPACE_ACP_METHODS.snapshot,
    { sessionId }
  );
}

/** Releases exactly the current stable semantic action through ACP. */
async function _stepCurrent(
  connection: ClientConnection,
  sessionId: string,
  known?: PiAcpDebugResponse
): Promise<PiAcpDebugResponse> {
  const snapshot = known ?? (await _snapshot(connection, sessionId));
  const action = snapshot.snapshot.nextAction;
  if (action === undefined) {
    throw new Error(`Pi Session "${sessionId}" has no action to Step.`);
  }
  return connection.agent.request<PiAcpDebugResponse, PiAcpStepRequest>(
    LLM_SPACE_ACP_METHODS.step,
    {
      sessionId,
      afterSeq: snapshot.cursor,
      commandId: crypto.randomUUID(),
      expectedActionId: action.id,
      kind: action.kind,
    }
  );
}

/** Refreshes Studio metadata after ACP has committed Pi state. */
async function* _refresh(options: PlaygroundThreadRuntimeOptions) {
  const latest = await options.client.load(options.playgroundId);
  if (latest === undefined) {
    throw new Error(`Playground "${options.playgroundId}" was not found.`);
  }
  options.onPlayground(latest);
  yield {
    type: "thread.updated" as const,
    thread: playgroundToEditorThread(latest),
  };
}

/** Resolves the accepted ACP prompt when its final state notification arrives. */
class SessionUpdateWaiter {
  private readonly _waiters = new Map<
    string,
    { resolve(): void; reject(error: Error): void }
  >();

  /** Waits for the next non-running state update for one ACP Session. */
  waitForStop(sessionId: string): Promise<void> {
    if (this._waiters.has(sessionId)) {
      throw new Error(`ACP Session "${sessionId}" already has a waiter.`);
    }
    return new Promise<void>((resolve, reject) => {
      this._waiters.set(sessionId, { resolve, reject });
    });
  }

  /** Consumes only state updates; transcript updates are rendered after refresh. */
  accept(notification: UpdateSessionNotification): void {
    const waiter = this._waiters.get(notification.sessionId);
    const update = notification.update;
    if (
      waiter === undefined ||
      update.sessionUpdate !== "state_update" ||
      update.state === "running"
    ) {
      return;
    }
    this._waiters.delete(notification.sessionId);
    const metadata = _isRecord(update._meta)
      ? update._meta["llm-space.dev"]
      : undefined;
    if (
      _isRecord(metadata) &&
      metadata.status === "failed" &&
      typeof metadata.error === "string"
    ) {
      waiter.reject(new Error(metadata.error));
    } else {
      waiter.resolve();
    }
  }
}

/** Narrows ACP implementation metadata before reading failure details. */
function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Loads the Electrobun transport only when production execution actually starts. */
async function _openDesktopAcpConnection(
  options: OpenDesktopAcpConnectionOptions
): Promise<ClientConnection> {
  const { openDesktopAcpConnection } = await import("@/client/acp-client");
  return openDesktopAcpConnection(options);
}
