import type { Thread } from "@llm-space/core";

import type { ThreadStore } from "./stores";

export interface ThreadPlaygroundEventCallbacks {
  onChange?: (thread: Thread) => void;
  onStreamingStart?: (runId: string) => boolean | void;
  onStreamingEnd?: (runId: string) => void;
}

export type RunChangePersistence = "editor" | "runtime";

export interface ThreadPlaygroundEventOptions {
  readonly runChangePersistence?: RunChangePersistence;
}

/** Subscribes persistence/lifecycle callbacks to one Thread store. */
export function subscribeThreadPlaygroundEvents(
  store: ThreadStore,
  callbacks: ThreadPlaygroundEventCallbacks,
  options: ThreadPlaygroundEventOptions = {},
  state: {
    readonly rejectedRunIds: Set<string>;
    readonly runStartThreads: Map<string, Thread>;
  } = {
    rejectedRunIds: new Set(),
    runStartThreads: new Map(),
  }
): () => void {
  return store.subscribe((current, previous) => {
    const { status } = current;
    const previousStatus = previous.status;

    if (status === "preparing" && previousStatus === "idle") {
      const runId = current.activeRunId;
      if (runId) state.runStartThreads.set(runId, current.thread);
      if (runId && callbacks.onStreamingStart?.(runId) === false) {
        state.rejectedRunIds.add(runId);
        store.getState().abort();
      }
    }

    if (
      status === "idle" &&
      (previousStatus === "preparing" || previousStatus === "running")
    ) {
      const runId = previous.activeRunId;
      const startThread = runId
        ? state.runStartThreads.get(runId)
        : undefined;
      if (runId) state.runStartThreads.delete(runId);
      if (runId && state.rejectedRunIds.delete(runId)) return;
      // Editor-owned runs flush their completed transcript. Runtime-owned runs
      // already committed their authoritative projection; sending it through
      // onChange would manufacture a Draft and can collide with a paused run.
      if (
        options.runChangePersistence !== "runtime" &&
        startThread !== undefined &&
        current.thread !== startThread
      ) {
        callbacks.onChange?.(current.thread);
      }
      // The store may synchronously attach terminal run metadata immediately
      // after setting idle. Let those updates reach onChange before a host
      // treats the pane as settled and tears down its runtime.
      if (runId) {
        queueMicrotask(() => callbacks.onStreamingEnd?.(runId));
      }
      return;
    }

    if (current.thread === previous.thread || status === "running") {
      return;
    }

    callbacks.onChange?.(current.thread);
  });
}
