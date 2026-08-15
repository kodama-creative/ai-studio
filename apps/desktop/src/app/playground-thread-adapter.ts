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

import { createThreadExecutionRuntime } from "./thread-execution-runtime";

export interface PlaygroundThreadRuntimeOptions {
  readonly client: PlaygroundClient;
  readonly threadClient?: ThreadClient;
  readonly playgroundId: string;
  readonly getPlayground: () => Playground;
  readonly onPlayground: (playground: Playground) => void;
  readonly beforeAdmission?: () => void | Promise<void>;
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
  return createThreadExecutionRuntime({
    productName: "Playground",
    target,
    getClient: () => _threadClient(options),
    currentOperationId: () => options.getPlayground().operationId,
    async persist(thread) {
      const playground = await options.client.save(
        options.playgroundId,
        _document(thread, options.getPlayground())
      );
      options.onPlayground(playground);
    },
    async refresh() {
      const playground = await _requirePlayground(options);
      return {
        operationId: playground.operationId,
        thread: playgroundToEditorThread(playground),
      };
    },
    beforeAdmission: options.beforeAdmission,
    onSettled: options.onSettled,
  });
}

function _document(
  thread: Thread,
  playground: Playground
): SavePlaygroundInput {
  return threadToPlaygroundDocument(thread, playground.conversation.state);
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

async function _threadClient(
  options: PlaygroundThreadRuntimeOptions
): Promise<ThreadClient> {
  if (options.threadClient !== undefined) return options.threadClient;
  const { createThreadClient } = await import("@/client/thread-client");
  return createThreadClient();
}
