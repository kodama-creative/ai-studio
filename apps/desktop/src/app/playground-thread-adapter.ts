import type { Thread } from "@llm-space/core";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
  type Playground,
  type SavePlaygroundInput,
} from "@llm-space/studio";
import type { AcpSessionExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type { AcpSessionClient } from "@/shared/acp-session-rpc";
import type { PlaygroundClient } from "@/shared/playground-rpc";

import { createDesktopAcpSessionRuntime } from "./acp-session-runtime";

export interface PlaygroundThreadRuntimeOptions {
  readonly client: PlaygroundClient;
  readonly acpClient: AcpSessionClient;
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
): AcpSessionExecutionRuntime {
  const target = {
    kind: "playground",
    playgroundId: options.playgroundId,
  } as const;
  return createDesktopAcpSessionRuntime({
    client: options.acpClient,
    target,
    sessionId: options.getPlayground().sessionId,
    async persistPrompt(thread) {
      const playground = await options.client.save(
        options.playgroundId,
        _document(thread, options.getPlayground())
      );
      options.onPlayground(playground);
    },
    beforePrompt: options.beforeAdmission,
    async onSettled() {
      await _requirePlayground(options);
      await options.onSettled?.();
    },
  });
}

function _document(
  thread: Thread,
  playground: Playground
): SavePlaygroundInput {
  return {
    ...threadToPlaygroundDocument(thread, playground.conversation.state),
    // Transcript input is carried only by ACP Prompt/context. This save updates
    // editable Agent metadata without creating a second message transport.
    conversation: structuredClone(playground.conversation),
  };
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
