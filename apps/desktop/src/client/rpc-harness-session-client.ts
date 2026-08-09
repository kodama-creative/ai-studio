import type { HarnessEvent, SessionEventCursor } from "@llm-space/harness";

import { electrobun } from "@/lib/electrobun";
import type { ProjectSessionEventPayload } from "@/shared/rpc";

import type { HarnessSessionClient } from "./harness-session-client";

const EVENT_COMPACTION_THRESHOLD = 1024;

/** Adapt the project-window RPC stream into the renderer Harness interface. */
export function createRpcHarnessSessionClient(): HarnessSessionClient {
  const rpc = _rpc();
  return {
    listThreads: () => rpc.request.projectListThreads({}),
    createThread: (input = {}) =>
      rpc.request.projectCreateThread(input),
    attachThread: (threadId) =>
      rpc.request.projectAttachThread({ threadId }),
    send: (sessionId, message) =>
      rpc.request.projectSessionSend({ sessionId, message }),
    cancel: async (sessionId) => {
      await rpc.request.projectSessionCancel({ sessionId });
    },
    snapshot: (sessionId) =>
      rpc.request.projectSessionSnapshot({ sessionId }),
    events: (sessionId, cursor) => _events(sessionId, cursor),
  };
}

async function* _events(
  sessionId: string,
  cursor: SessionEventCursor = {}
): AsyncIterable<HarnessEvent> {
  const rpc = _rpc();
  const subscriptionId = crypto.randomUUID();
  let events: (HarnessEvent | undefined)[] = [];
  let eventHead = 0;
  let wake: (() => void) | undefined;
  let errorMessage: string | undefined;
  let aborted = cursor.signal?.aborted ?? false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onResponse = (message: ProjectSessionEventPayload) => {
    if (message.subscriptionId !== subscriptionId) return;
    if (message.type === "event") events.push(message.event);
    else errorMessage = message.message;
    notify();
  };
  const onAbort = () => {
    aborted = true;
    notify();
  };

  rpc.addMessageListener("receiveProjectSessionEvent", onResponse);
  cursor.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (aborted) return;
    rpc.send.projectSessionSubscribe({
      subscriptionId,
      sessionId,
      ...(cursor.afterSequence === undefined
        ? {}
        : { afterSequence: cursor.afterSequence }),
    });
    while (true) {
      while (eventHead < events.length) {
        const event = events[eventHead];
        events[eventHead] = undefined;
        eventHead += 1;
        yield event!;
        if (eventHead === events.length) {
          events.length = 0;
          eventHead = 0;
        } else if (
          eventHead >= EVENT_COMPACTION_THRESHOLD &&
          eventHead * 2 >= events.length
        ) {
          events = events.slice(eventHead);
          eventHead = 0;
        }
      }
      if (errorMessage !== undefined) throw new Error(errorMessage);
      if (aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    rpc.removeMessageListener("receiveProjectSessionEvent", onResponse);
    cursor.signal?.removeEventListener("abort", onAbort);
    rpc.send.projectSessionUnsubscribe({ subscriptionId });
  }
}

function _rpc(): NonNullable<typeof electrobun.rpc> {
  const rpc = electrobun.rpc;
  if (rpc === undefined) throw new Error("Electrobun RPC is not initialized.");
  return rpc;
}
