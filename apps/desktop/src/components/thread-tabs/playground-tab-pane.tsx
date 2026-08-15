"use client";

import type { Thread } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";
import { ThreadPlayground } from "@llm-space/ui/components/thread-playground";
import { cn } from "@llm-space/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import {
  createPlaygroundThreadExecutionRuntime,
  playgroundToEditorThread,
} from "@/app/playground-thread-adapter";
import { SerializedPersistence } from "@/app/thread/serialized-persistence";
import { createPlaygroundClient } from "@/client/playground-client";

import type { PaneLifecycleHost } from "./pane-lifecycle-host";
import { settleStreamingPane } from "./settle-streaming-pane";
import { usePaneRefreshAcknowledgement } from "./use-pane-refresh-ack";

interface PlaygroundTabPaneProps {
  tabId: string;
  paneId: string;
  playgroundId: string;
  active: boolean;
  lifecycleHost: PaneLifecycleHost;
  refreshNonce?: number;
  onClose: (tabId: string) => void;
  onTitleChange?: (playgroundId: string, title: string) => void;
  onThreadStateChange?: (tabId: string, thread: Thread | null) => void;
}

/** One local Studio Playground backed by Studio metadata + Pi Session state. */
function _PlaygroundTabPane({
  tabId,
  paneId,
  playgroundId,
  active,
  lifecycleHost,
  refreshNonce = 0,
  onClose,
  onTitleChange,
  onThreadStateChange,
}: PlaygroundTabPaneProps) {
  const queryClient = useQueryClient();
  const client = useMemo(() => createPlaygroundClient(), []);
  const queryKey = useMemo(
    () => ["playground", playgroundId] as const,
    [playgroundId]
  );
  const {
    data: loaded,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => client.load(playgroundId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const playgroundRef = useRef<Playground | undefined>(undefined);
  const durableThreadRef = useRef<Thread | undefined>(undefined);
  const editorThread = loaded && playgroundToEditorThread(loaded);
  useEffect(() => {
    if (loaded !== undefined) {
      playgroundRef.current = loaded;
      durableThreadRef.current = playgroundToEditorThread(loaded);
    }
  }, [loaded]);

  useEffect(() => {
    if (loaded !== undefined) {
      onThreadStateChange?.(tabId, playgroundToEditorThread(loaded));
      onTitleChange?.(playgroundId, loaded.title);
    }
  }, [loaded, onThreadStateChange, onTitleChange, playgroundId, tabId]);
  useEffect(
    () => () => onThreadStateChange?.(tabId, null),
    [onThreadStateChange, tabId]
  );

  useEffect(() => {
    if (!isError && loaded !== undefined) return;
    if (isLoading) return;
    toast.error("Unable to open Playground", {
      description:
        error instanceof Error
          ? error.message
          : `Playground "${playgroundId}" was not found.`,
    });
    onClose(tabId);
  }, [error, isError, isLoading, loaded, onClose, playgroundId, tabId]);

  const [persistenceOwner] = useState<object>(() => ({}));
  const persistence = useMemo(
    () =>
      new SerializedPersistence<Thread>(
        async (next) => {
          const current = playgroundRef.current;
          if (current === undefined) return;
          const document = {
            title: next.title?.trim() || current.title,
            agentSpec: {
              schemaVersion: 1 as const,
              ...(next.model === undefined
                ? {}
                : { model: structuredClone(next.model) }),
              instructions:
                next.context?.systemPrompt === undefined
                  ? []
                  : [next.context.systemPrompt],
              tools: structuredClone(next.context?.tools ?? []),
              ...(next.context?.variables === undefined
                ? {}
                : { variables: structuredClone(next.context.variables) }),
              ...(next.context?.variableVariants === undefined
                ? {}
                : {
                    variableVariants: structuredClone(
                      next.context.variableVariants
                    ),
                  }),
            },
            conversation: {
              messages: structuredClone(next.context?.messages ?? []),
              state: structuredClone(current.conversation.state),
            },
          };
          const saved = await client.save(playgroundId, document);
          playgroundRef.current = saved;
          queryClient.setQueryData(queryKey, saved);
          onTitleChange?.(playgroundId, saved.title);
        },
        {
          onBusyChange: (busy) =>
            lifecycleHost.onPersistenceChange(paneId, persistenceOwner, busy),
          onWriteError: (writeError) => {
            toast.error("Failed to save Playground; retrying", {
              description:
                writeError instanceof Error
                  ? writeError.message
                  : "Storage is temporarily unavailable.",
            });
          },
        }
      ),
    [
      client,
      lifecycleHost,
      onTitleChange,
      paneId,
      persistenceOwner,
      playgroundId,
      queryClient,
      queryKey,
    ]
  );
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPending = useCallback(async () => {
    if (writeTimer.current !== null) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    await persistence.flush();
  }, [persistence]);
  const handleChange = useCallback(
    (next: Thread) => {
      onThreadStateChange?.(tabId, next);
      // External execution already persisted this exact editor projection in
      // Pi Session. Treat only divergent editor state as a dirty application Draft.
      if (_sameThread(next, durableThreadRef.current)) return;
      persistence.setPending(next);
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => {
        void flushPending();
      }, 500);
    },
    [flushPending, onThreadStateChange, persistence, tabId]
  );
  useEffect(() => () => void flushPending(), [flushPending]);

  const runtime = useMemo(
    () =>
      createPlaygroundThreadExecutionRuntime({
        client,
        playgroundId,
        getPlayground: () => {
          const current = playgroundRef.current;
          if (current === undefined) {
            throw new Error(`Playground "${playgroundId}" is not loaded.`);
          }
          return current;
        },
        onPlayground: (next) => {
          playgroundRef.current = next;
          durableThreadRef.current = playgroundToEditorThread(next);
          queryClient.setQueryData(queryKey, next);
          onTitleChange?.(playgroundId, next.title);
        },
        beforeAdmission: flushPending,
      }),
    [client, flushPending, onTitleChange, playgroundId, queryClient, queryKey]
  );
  const handleStreamingStart = useCallback(
    (runId: string) => lifecycleHost.onRunStart(paneId, runId),
    [lifecycleHost, paneId]
  );
  const handleStreamingEnd = useCallback(
    (runId: string) => {
      void settleStreamingPane(flushPending, () => {
        lifecycleHost.onRunSettled(paneId, runId);
      });
    },
    [flushPending, lifecycleHost, paneId]
  );
  const handleRenameTitle = useCallback(
    async (title: string) => {
      const current = playgroundRef.current;
      if (current === undefined) return false;
      const saved = await client.save(playgroundId, {
        title,
        agentSpec: current.agentSpec,
        conversation: current.conversation,
      });
      playgroundRef.current = saved;
      queryClient.setQueryData(queryKey, saved);
      onTitleChange?.(playgroundId, saved.title);
      return true;
    },
    [client, onTitleChange, playgroundId, queryClient, queryKey]
  );

  const [reloadKey, setReloadKey] = useState(0);
  const appliedRefreshRef = useRef(refreshNonce);
  const { markCommitPending, settleWithoutCommit } =
    usePaneRefreshAcknowledgement({
      paneId,
      reloadKey,
      onSettled: lifecycleHost.onRefreshSettled,
    });
  useEffect(() => {
    if (appliedRefreshRef.current === refreshNonce) return;
    appliedRefreshRef.current = refreshNonce;
    persistence.discardPending();
    void queryClient
      .refetchQueries({ queryKey, exact: true })
      .then(() => {
        markCommitPending();
        setReloadKey((key) => key + 1);
      })
      .catch((cause: unknown) => {
        toast.error("Unable to refresh Playground", {
          description: cause instanceof Error ? cause.message : String(cause),
        });
        settleWithoutCommit();
      });
  }, [
    markCommitPending,
    persistence,
    queryClient,
    queryKey,
    refreshNonce,
    settleWithoutCommit,
  ]);

  const getMutationReserved = useCallback(
    () => lifecycleHost.isMutationReserved(paneId),
    [lifecycleHost, paneId]
  );
  const mutationReserved = useSyncExternalStore(
    lifecycleHost.subscribeToMutationChanges,
    getMutationReserved,
    getMutationReserved
  );

  return (
    <div className={cn("size-full", !active && "hidden")}>
      {editorThread !== undefined ? (
        <ThreadPlayground
          storeKey={reloadKey}
          className="bg-background size-full shadow-lg"
          path={`playgrounds/${playgroundId}`}
          title={loaded?.title}
          initialValue={editorThread}
          readonly={mutationReserved}
          active={active}
          executionRuntime={runtime}
          onChange={handleChange}
          onStreamingStart={handleStreamingStart}
          onStreamingEnd={handleStreamingEnd}
          onRenameTitle={handleRenameTitle}
        />
      ) : null}
    </div>
  );
}

export const PlaygroundTabPane = memo(_PlaygroundTabPane);

function _sameThread(left: Thread, right: Thread | undefined): boolean {
  return right !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
