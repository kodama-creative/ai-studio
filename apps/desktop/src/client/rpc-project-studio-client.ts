import type { StudioEventCursor, StudioThreadEvent } from "@llm-space/studio";

import { electrobun } from "@/lib/electrobun";
import type { ProjectSourceSnapshot } from "@/shared/project-studio";
import type {
  ProjectSourceEventPayload,
  ProjectStudioEventPayload,
} from "@/shared/rpc";

import type { ProjectStudioClient } from "./project-studio-client";

const EVENT_COMPACTION_THRESHOLD = 1024;

export function createRpcProjectStudioClient(): ProjectStudioClient {
  const rpc = _rpc();
  return {
    getSourceRevision: () => rpc.request.projectGetSourceRevision({}),
    listSourceFiles: () => rpc.request.projectListSourceFiles({}),
    readSourceFile: (path) => rpc.request.projectReadSourceFile({ path }),
    watchSourceFiles: (input) => _sourceEvents(input?.signal),
    listThreads: () => rpc.request.projectListThreads({}),
    listRunHistory: (threadId) =>
      rpc.request.projectListRunHistory({ threadId }),
    saveRunHistory: (threadId, runIds) =>
      rpc.request.projectSaveRunHistory({ threadId, runIds }),
    listEvaluationMetadata: (threadId) =>
      rpc.request.projectListEvaluationMetadata({ threadId }),
    saveEvaluationMetadata: (threadId, input) =>
      rpc.request.projectSaveEvaluationMetadata({ threadId, ...input }),
    createThread: (input = {}) => rpc.request.projectCreateThread(input),
    forkThread: (threadId, input = {}) =>
      rpc.request.projectForkThread({ threadId, ...input }),
    loadThread: (threadId) => rpc.request.projectLoadThread({ threadId }),
    saveDocument: (threadId, document) =>
      rpc.request.projectSaveThreadDocument({ threadId, document }),
    run: (threadId, input) =>
      rpc.request.projectRunThread({ threadId, ...input }),
    cancelRun: async (runId) => {
      await rpc.request.projectCancelRun({ runId });
    },
    events: (threadId, cursor) => _events(threadId, cursor),
  };
}

async function* _sourceEvents(
  signal?: AbortSignal
): AsyncIterable<ProjectSourceSnapshot> {
  const rpc = _rpc();
  const subscriptionId = crypto.randomUUID();
  const snapshots: ProjectSourceSnapshot[] = [];
  let wake: (() => void) | undefined;
  let errorMessage: string | undefined;
  let aborted = signal?.aborted ?? false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onResponse = (message: ProjectSourceEventPayload) => {
    if (message.subscriptionId !== subscriptionId) return;
    if (message.type === "snapshot") snapshots.push(message.snapshot);
    else errorMessage = message.message;
    notify();
  };
  const onAbort = () => {
    aborted = true;
    notify();
  };
  rpc.addMessageListener("receiveProjectSourceEvent", onResponse);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (aborted) return;
    rpc.send.projectSourceSubscribe({ subscriptionId });
    while (true) {
      const snapshot = snapshots.shift();
      if (snapshot !== undefined) {
        yield snapshot;
        continue;
      }
      if (errorMessage !== undefined) throw new Error(errorMessage);
      if (aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    rpc.removeMessageListener("receiveProjectSourceEvent", onResponse);
    signal?.removeEventListener("abort", onAbort);
    rpc.send.projectSourceUnsubscribe({ subscriptionId });
  }
}

async function* _events(
  threadId: string,
  cursor: StudioEventCursor = {}
): AsyncIterable<StudioThreadEvent> {
  const rpc = _rpc();
  const subscriptionId = crypto.randomUUID();
  let events: (StudioThreadEvent | undefined)[] = [];
  let eventHead = 0;
  let wake: (() => void) | undefined;
  let errorMessage: string | undefined;
  let aborted = cursor.signal?.aborted ?? false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onResponse = (message: ProjectStudioEventPayload) => {
    if (message.subscriptionId !== subscriptionId) return;
    if (message.type === "event") events.push(message.event);
    else errorMessage = message.message;
    notify();
  };
  const onAbort = () => {
    aborted = true;
    notify();
  };

  rpc.addMessageListener("receiveProjectStudioEvent", onResponse);
  cursor.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (aborted) return;
    rpc.send.projectThreadSubscribe({
      subscriptionId,
      threadId,
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
    rpc.removeMessageListener("receiveProjectStudioEvent", onResponse);
    cursor.signal?.removeEventListener("abort", onAbort);
    rpc.send.projectThreadUnsubscribe({ subscriptionId });
  }
}

function _rpc(): NonNullable<typeof electrobun.rpc> {
  const rpc = electrobun.rpc;
  if (rpc === undefined) throw new Error("Electrobun RPC is not initialized.");
  return rpc;
}
