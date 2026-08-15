import type { Thread } from "@llm-space/core";
import type { ExternalThreadExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type {
  ThreadClient,
  ThreadRunInput,
  ThreadTarget,
} from "@/shared/thread-rpc";

interface ExecutionProjection {
  readonly operationId?: string;
  readonly thread: Thread;
}

export interface ThreadExecutionRuntimeOptions {
  readonly productName: string;
  readonly target: ThreadTarget;
  readonly getClient: () => Promise<ThreadClient>;
  readonly currentOperationId: () => string | undefined;
  readonly persist: (thread: Thread) => Promise<void>;
  readonly refresh: (source: Thread) => Promise<ExecutionProjection>;
  readonly runOverrides?: (
    thread: Thread
  ) => Pick<ThreadRunInput, "modelOverride">;
  readonly beforeAdmission?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}

/** Owns the complete editor-to-Thread-RPC execution lifecycle for both products. */
export function createThreadExecutionRuntime(
  options: ThreadExecutionRuntimeOptions
): ExternalThreadExecutionRuntime {
  return {
    async *execute(request) {
      const client = await options.getClient();
      try {
        let operationId = options.currentOperationId();
        if (operationId === undefined) {
          await options.beforeAdmission?.();
          await options.persist(request.thread);
          const fromMessageId = _requireUserInput(
            options.productName,
            request.thread,
            request.fromMessageId
          );
          const receipt = await client.run(options.target, {
            fromMessageId,
            commandId: crypto.randomUUID(),
            mode: request.reactLoop ? "continue" : "step",
            signal: request.signal,
            ...options.runOverrides?.(request.thread),
          });
          operationId = receipt.operationId;
        } else if (request.reactLoop) {
          await client.continue(options.target, operationId, {
            commandId: crypto.randomUUID(),
            signal: request.signal,
          });
        } else {
          await _stepCurrent(client, options.target, operationId, request.signal);
        }

        if (!request.reactLoop && request.autoRunTools) {
          let projection = await options.refresh(request.thread);
          while (projection.operationId !== undefined) {
            const snapshot = await client.inspect(
              options.target,
              projection.operationId
            );
            if (snapshot.nextAction?.kind !== "tool") break;
            await _stepCurrent(
              client,
              options.target,
              projection.operationId,
              request.signal,
              snapshot
            );
            projection = await options.refresh(request.thread);
          }
        }
        yield* _refresh(options, client, request.thread, request.reactLoop ? "continue" : "step");
      } finally {
        await _settle(options, client, request.signal);
      }
    },

    async *executeToolCall(request) {
      const client = await options.getClient();
      const operationId = _requireOperation(
        options.productName,
        options.currentOperationId(),
        "tool call"
      );
      try {
        const snapshot = await client.inspect(options.target, operationId);
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
          options.target,
          operationId,
          request.signal,
          snapshot
        );
        yield { type: "tool.completed", toolCallId: request.toolCallId };
        yield* _refresh(options, client, request.thread, "step");
      } finally {
        await _settle(options, client, request.signal);
      }
    },

    async *resolveToolApproval(request) {
      const client = await options.getClient();
      const operationId = _requireOperation(
        options.productName,
        options.currentOperationId(),
        "Tool approval"
      );
      try {
        await client.resolveToolApproval(options.target, operationId, {
          toolCallId: request.toolCallId,
          approved: request.approved,
          signal: request.signal,
        });
        if (request.resumeMode === "continue") {
          await client.continue(options.target, operationId, {
            commandId: crypto.randomUUID(),
            signal: request.signal,
          });
        } else {
          await _stepCurrent(client, options.target, operationId, request.signal);
        }
        yield* _refresh(options, client, request.thread, request.resumeMode);
      } finally {
        await _settle(options, client, request.signal);
      }
    },
  };
}

function _requireUserInput(
  productName: string,
  thread: Thread,
  requestedId: string | undefined
): string {
  const fromMessageId =
    requestedId ?? thread.context?.messages?.at(-1)?.id;
  if (fromMessageId === undefined) {
    throw new Error(`${productName} operation requires at least one Message.`);
  }
  const message = thread.context?.messages?.find(
    (candidate) => candidate.id === fromMessageId
  );
  if (message?.role !== "user") {
    throw new Error(
      `${productName} operation input "${fromMessageId}" must be a user Message.`
    );
  }
  return fromMessageId;
}

function _requireOperation(
  productName: string,
  operationId: string | undefined,
  action: string
): string {
  if (operationId === undefined) {
    throw new Error(
      `The ${action} does not belong to an active ${productName} operation.`
    );
  }
  return operationId;
}

async function _stepCurrent(
  client: ThreadClient,
  target: ThreadTarget,
  operationId: string,
  signal: AbortSignal,
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
    signal,
  });
}

async function* _refresh(
  options: ThreadExecutionRuntimeOptions,
  client: ThreadClient,
  source: Thread,
  resumeMode: "step" | "continue"
) {
  const projection = await options.refresh(source);
  yield { type: "thread.updated" as const, thread: projection.thread };
  if (projection.operationId === undefined) return;
  const snapshot = await client.inspect(options.target, projection.operationId);
  if (snapshot.approval?.status !== "pending") return;
  yield {
    type: "tool.approval.required" as const,
    toolCallId: snapshot.approval.toolCallId,
    toolName: snapshot.approval.toolName,
    resumeMode,
  };
}

async function _settle(
  options: ThreadExecutionRuntimeOptions,
  client: ThreadClient,
  signal: AbortSignal
): Promise<void> {
  try {
    if (signal.aborted) await client.cancel(options.target);
  } finally {
    await options.onSettled?.();
  }
}
