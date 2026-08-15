import type { Thread } from "@llm-space/core";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
  type Playground,
  type SavePlaygroundInput,
} from "@llm-space/studio";
import type { ExternalThreadExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type { PlaygroundClient } from "@/client/playground-client";
import type { ThreadClient, ThreadTarget } from "@/shared/thread-rpc";

export interface PlaygroundThreadRuntimeOptions {
  readonly client: PlaygroundClient;
  readonly threadClient?: ThreadClient;
  readonly playgroundId: string;
  readonly getPlayground: () => Playground;
  readonly onPlayground: (playground: Playground) => void;
  readonly beforeExecute?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}

/** Presents a durable Studio Playground through the editor-only Thread model. */
export function playgroundToEditorThread(playground: Playground): Thread {
  return playgroundToThread(playground);
}

/** Adapts editor controls directly to the product-owned Thread RPC namespace. */
export function createPlaygroundThreadExecutionRuntime(
  options: PlaygroundThreadRuntimeOptions
): ExternalThreadExecutionRuntime {
  const target: ThreadTarget = {
    kind: "playground",
    playgroundId: options.playgroundId,
  };
  return {
    async *execute(request) {
      await options.beforeExecute?.();
      const client = await _threadClient(options);
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
          await client.run(target, {
            fromMessageId,
            commandId: crypto.randomUUID(),
            mode: request.reactLoop ? "continue" : "step",
          });
        } else if (request.reactLoop) {
          await client.continue(target, playground.operationId, {
            commandId: crypto.randomUUID(),
          });
        } else {
          await _stepCurrent(client, target, playground.operationId);
        }

        if (!request.reactLoop && request.autoRunTools) {
          playground = await _requirePlayground(options);
          while (playground.operationId !== undefined) {
            const snapshot = await client.inspect(
              target,
              playground.operationId
            );
            if (snapshot.nextAction?.kind !== "tool") break;
            await _stepCurrent(
              client,
              target,
              playground.operationId,
              snapshot
            );
            playground = await _requirePlayground(options);
          }
        }
        yield* _refresh(
          options,
          client,
          target,
          request.reactLoop ? "continue" : "step"
        );
      } finally {
        if (request.signal.aborted && playground.operationId !== undefined) {
          await client.cancel(target, playground.operationId);
        }
        await options.onSettled?.();
      }
    },

    async *executeToolCall(request) {
      await options.beforeExecute?.();
      const client = await _threadClient(options);
      const playground = options.getPlayground();
      if (playground.operationId === undefined) {
        throw new Error(
          "The tool call does not belong to an active operation."
        );
      }
      try {
        const snapshot = await client.inspect(target, playground.operationId);
        const action = snapshot.nextAction;
        if (
          action?.kind !== "tool" ||
          action.toolCallId !== request.toolCallId
        ) {
          throw new Error(
            `Tool call "${request.toolCallId}" is not the current Pi action.`
          );
        }
        yield { type: "tool.started", toolCallId: request.toolCallId };
        await _stepCurrent(
          client,
          target,
          playground.operationId,
          snapshot
        );
        yield { type: "tool.completed", toolCallId: request.toolCallId };
        yield* _refresh(options, client, target, "step");
      } finally {
        if (request.signal.aborted) {
          await client.cancel(target, playground.operationId);
        }
        await options.onSettled?.();
      }
    },

    async *resolveToolApproval(request) {
      await options.beforeExecute?.();
      const client = await _threadClient(options);
      const playground = options.getPlayground();
      if (playground.operationId === undefined) {
        throw new Error("The Tool approval does not belong to an active operation.");
      }
      try {
        await client.resolveToolApproval(target, playground.operationId, {
          toolCallId: request.toolCallId,
          approved: request.approved,
        });
        if (request.resumeMode === "continue") {
          await client.continue(target, playground.operationId, {
            commandId: crypto.randomUUID(),
          });
        } else {
          await _stepCurrent(client, target, playground.operationId);
        }
        yield* _refresh(options, client, target, request.resumeMode);
      } finally {
        if (request.signal.aborted) {
          await client.cancel(target, playground.operationId);
        }
        await options.onSettled?.();
      }
    },
  };
}

function _document(
  thread: Thread,
  playground: Playground
): SavePlaygroundInput {
  return threadToPlaygroundDocument(thread, playground.conversation.state);
}

async function _stepCurrent(
  client: ThreadClient,
  target: ThreadTarget,
  operationId: string,
  known?: Awaited<ReturnType<ThreadClient["inspect"]>>
) {
  const snapshot = known ?? (await client.inspect(target, operationId));
  const action = snapshot.nextAction;
  if (action === undefined) {
    throw new Error(`Pi operation "${operationId}" has no action to Step.`);
  }
  return client.step(target, operationId, {
    commandId: crypto.randomUUID(),
    expectedActionId: action.id,
    kind: action.kind,
  });
}

async function _requirePlayground(
  options: PlaygroundThreadRuntimeOptions
): Promise<Playground> {
  const playground = await options.client.load(options.playgroundId);
  if (playground === undefined) {
    throw new Error(`Playground "${options.playgroundId}" was not found.`);
  }
  options.onPlayground(playground);
  return playground;
}

async function* _refresh(
  options: PlaygroundThreadRuntimeOptions,
  client: ThreadClient,
  target: ThreadTarget,
  resumeMode: "step" | "continue"
) {
  const playground = await _requirePlayground(options);
  yield {
    type: "thread.updated" as const,
    thread: playgroundToEditorThread(playground),
  };
  if (playground.operationId === undefined) return;
  const snapshot = await client.inspect(target, playground.operationId);
  if (snapshot.approval?.status !== "pending") return;
  yield {
    type: "tool.approval.required" as const,
    toolCallId: snapshot.approval.toolCallId,
    toolName: snapshot.approval.toolName,
    resumeMode,
  };
}

async function _threadClient(
  options: PlaygroundThreadRuntimeOptions
): Promise<ThreadClient> {
  if (options.threadClient !== undefined) return options.threadClient;
  const { createThreadClient } = await import("@/client/thread-client");
  return createThreadClient();
}
