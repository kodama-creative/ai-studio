import type { Thread } from "@llm-space/core";
import { sharedSessionUpdatesFromMessages } from "@llm-space/core";
import type { AcpSessionExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type {
  AcpSessionClient,
  AcpSessionTarget,
} from "@/shared/acp-session-rpc";

export interface DesktopAcpSessionRuntimeOptions {
  readonly client: AcpSessionClient;
  readonly target: AcpSessionTarget;
  readonly sessionId: string;
  readonly persistPrompt: (thread: Thread) => Promise<void>;
  readonly modelOverride?: (thread: Thread) => string | undefined;
  readonly beforePrompt?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}

/** Adapts the typed Electrobun carrier to the UI's browser-safe ACP seam. */
export function createDesktopAcpSessionRuntime(
  options: DesktopAcpSessionRuntimeOptions
): AcpSessionExecutionRuntime {
  const settle = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } finally {
      await options.onSettled?.();
    }
  };
  return {
    sessionId: options.sessionId,
    updates: (input) =>
      options.client.updates(options.target, {
        afterCursor: input.afterCursor,
        signal: input.signal,
      }),
    prompt: (input) =>
      settle(async () => {
        await options.beforePrompt?.();
        await options.persistPrompt(input.thread);
        const messages = input.thread.context?.messages ?? [];
        const inputIndex = messages.findIndex(
          (message) => message.id === input.fromMessageId
        );
        if (messages[inputIndex]?.role !== "user") {
          throw new Error(
            `ACP Prompt input "${input.fromMessageId}" must be a user Message.`
          );
        }
        await options.client.prompt(options.target, {
          request: {
            sessionId: options.sessionId,
            prompt: [...input.prompt],
          },
          context: sharedSessionUpdatesFromMessages(
            messages.slice(0, inputIndex)
          ),
          messageId: input.fromMessageId,
          mode: input.mode,
          ...(options.modelOverride?.(input.thread) === undefined
            ? {}
            : { modelOverride: options.modelOverride?.(input.thread) }),
          signal: input.signal,
        });
      }),
    step: (input) =>
      settle(() => options.client.step(options.target, input)),
    turn: (input) =>
      settle(() => options.client.turn(options.target, input)),
    continue: (input) =>
      settle(() => options.client.continue(options.target, input)),
    requestPermission: (input) =>
      settle(() => options.client.requestPermission(options.target, input)),
    cancel: () => options.client.cancel(options.target),
  };
}
