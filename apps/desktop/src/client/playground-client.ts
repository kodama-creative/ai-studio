import type { RunEventCursor, RunFrame } from "@llm-space/engine";
import type {
  AgentSpec,
  Playground,
  SavePlaygroundInput,
  StudioRunReceipt,
} from "@llm-space/studio";

import { electrobun } from "@/lib/electrobun";
import type { PlaygroundRunFramePayload } from "@/shared/rpc";

export interface PlaygroundClient {
  list(): Promise<readonly Playground[]>;
  create(input: {
    readonly title?: string;
    readonly agentSpec: AgentSpec;
    readonly conversation?: import("@llm-space/engine").ThreadState;
  }): Promise<Playground>;
  load(playgroundId: string): Promise<Playground | undefined>;
  save(
    playgroundId: string,
    document: SavePlaygroundInput
  ): Promise<Playground>;
  run(
    playgroundId: string,
    input: {
      readonly fromMessageId: string;
      readonly mode?: import("@llm-space/engine").RunExecutionMode;
    }
  ): Promise<StudioRunReceipt>;
  stepRun(
    runId: string,
    input?: { readonly toolCallId?: string }
  ): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
  streamRun(runId: string, cursor?: RunEventCursor): AsyncIterable<RunFrame>;
}

export function createPlaygroundClient(): PlaygroundClient {
  const rpc = _rpc();
  return {
    list: () => rpc.request.playgroundList({}),
    create: (input) => rpc.request.playgroundCreate(input),
    load: (playgroundId) => rpc.request.playgroundLoad({ playgroundId }),
    save: (playgroundId, document) =>
      rpc.request.playgroundSave({ playgroundId, document }),
    run: (playgroundId, input) =>
      rpc.request.playgroundRun({ playgroundId, ...input }),
    stepRun: (runId, input = {}) =>
      rpc.request.playgroundStepRun({ runId, ...input }),
    continueRun: (runId) => rpc.request.playgroundContinueRun({ runId }),
    cancelRun: async (runId) => {
      await rpc.request.playgroundCancelRun({ runId });
    },
    streamRun: (runId, cursor) => _streamRun(runId, cursor),
  };
}

async function* _streamRun(
  runId: string,
  cursor: RunEventCursor = {}
): AsyncIterable<RunFrame> {
  const rpc = _rpc();
  const subscriptionId = crypto.randomUUID();
  const frames: RunFrame[] = [];
  let wake: (() => void) | undefined;
  let errorMessage: string | undefined;
  let done = false;
  let aborted = cursor.signal?.aborted ?? false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onFrame = (message: PlaygroundRunFramePayload) => {
    if (message.subscriptionId !== subscriptionId) return;
    if (message.type === "frame") frames.push(message.frame);
    else if (message.type === "error") errorMessage = message.message;
    else done = true;
    notify();
  };
  const onAbort = () => {
    aborted = true;
    notify();
  };
  rpc.addMessageListener("receivePlaygroundRunFrame", onFrame);
  cursor.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (aborted) return;
    rpc.send.playgroundRunSubscribe({
      subscriptionId,
      runId,
      ...(cursor.afterCursor === undefined
        ? {}
        : { afterCursor: cursor.afterCursor }),
    });
    while (true) {
      const frame = frames.shift();
      if (frame !== undefined) {
        yield frame;
        continue;
      }
      if (errorMessage !== undefined) throw new Error(errorMessage);
      if (done) return;
      if (aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    rpc.removeMessageListener("receivePlaygroundRunFrame", onFrame);
    cursor.signal?.removeEventListener("abort", onAbort);
    rpc.send.playgroundRunUnsubscribe({ subscriptionId });
  }
}

function _rpc(): NonNullable<typeof electrobun.rpc> {
  const rpc = electrobun.rpc;
  if (rpc === undefined) throw new Error("Electrobun RPC is not initialized.");
  return rpc;
}
