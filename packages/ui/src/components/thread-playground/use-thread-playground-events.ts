import type { Thread } from "@llm-space/core";
import { useLayoutEffect, useRef } from "react";

import type { ThreadStore } from "./stores";
import {
  subscribeThreadPlaygroundEvents,
  type ThreadPlaygroundEventCallbacks,
  type ThreadPlaygroundEventOptions,
} from "./thread-playground-events";

export function useThreadPlaygroundEvents(
  store: ThreadStore,
  callbacks: ThreadPlaygroundEventCallbacks,
  options: ThreadPlaygroundEventOptions = {}
): void {
  const runChangePersistence = options.runChangePersistence ?? "editor";
  const onChangeRef = useRef(callbacks.onChange);
  const onStreamingStartRef = useRef(callbacks.onStreamingStart);
  const onStreamingEndRef = useRef(callbacks.onStreamingEnd);
  const rejectedRunIdsRef = useRef(new Set<string>());
  const runStartThreadsRef = useRef(new Map<string, Thread>());

  // Install the latest callbacks and ownership subscription before the pane
  // becomes interactive. A run can enter `preparing` immediately after commit,
  // before passive effects have had a chance to flush.
  useLayoutEffect(() => {
    onChangeRef.current = callbacks.onChange;
    onStreamingStartRef.current = callbacks.onStreamingStart;
    onStreamingEndRef.current = callbacks.onStreamingEnd;
  });

  useLayoutEffect(() => {
    const unsubscribe = subscribeThreadPlaygroundEvents(
      store,
      {
        onChange: (thread) => onChangeRef.current?.(thread),
        onStreamingStart: (runId) => onStreamingStartRef.current?.(runId),
        onStreamingEnd: (runId) => onStreamingEndRef.current?.(runId),
      },
      { runChangePersistence },
      {
        rejectedRunIds: rejectedRunIdsRef.current,
        runStartThreads: runStartThreadsRef.current,
      }
    );
    return () => {
      // Abort while the subscription is still attached so the preparing/running
      // -> idle transition reaches the host's terminal persistence barrier.
      // This is the final defense for any future owner teardown that misses a
      // page-level mutation reservation.
      store.getState().abort();
      unsubscribe();
    };
  }, [runChangePersistence, store]);
}
