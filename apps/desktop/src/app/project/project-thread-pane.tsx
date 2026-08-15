import type { Thread } from "@llm-space/core";
import type { StudioRunHistoryEntry, StudioThread } from "@llm-space/studio";
import type { StudioEvaluationMetadata } from "@llm-space/studio/evaluation";
import {
  ThreadPlayground,
  type ThreadRunMetadata,
} from "@llm-space/ui/components/thread-playground";
import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";

import { SerializedPersistence } from "@/components/thread-tabs/serialized-persistence";
import type { ProjectStudioTransport } from "@/shared/project-studio";

import {
  createProjectThreadExecutionRuntime,
  playgroundThreadToStudioDocument,
  playgroundThreadToStudioEvaluationMetadata,
  shouldPersistProjectThread,
  studioThreadToPlaygroundThread,
} from "./project-thread-adapter";
import type { ProjectThreadsController } from "./project-threads-controller";

/** Pi-backed editor pane for one Project Studio Thread. */
export function ProjectThreadPane({
  client,
  controller,
  projectId,
  history,
  evaluationMetadata,
  thread,
}: {
  readonly client: ProjectStudioTransport;
  readonly controller: ProjectThreadsController;
  readonly projectId: string;
  readonly history: readonly StudioRunHistoryEntry[];
  readonly evaluationMetadata: StudioEvaluationMetadata;
  readonly thread: StudioThread;
}) {
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const metadataSaveChain = useRef(Promise.resolve());
  const publishThread = useCallback(
    (next: StudioThread) => {
      threadRef.current = next;
      controller.acceptThreadProjection(next);
    },
    [controller]
  );
  const persistence = useMemo(
    () =>
      new SerializedPersistence<Thread>(
        async (next) => {
          const current = threadRef.current;
          const saved = await client.saveDocument(
            current.id,
            playgroundThreadToStudioDocument(next, current)
          );
          publishThread(saved);
        },
        {
          onWriteError: (error) => {
            toast.error("Unable to save Studio Thread; retrying", {
              description: _errorMessage(error),
            });
          },
        }
      ),
    [client, publishThread]
  );
  const flushPending = useCallback(
    () => persistence.flush(),
    [persistence]
  );
  const persist = useCallback(
    (next: Thread): Promise<void> => {
      // Pi Session checkpoints already own execution projections. Queue a Draft
      // only when the editor changed fields Studio actually persists.
      if (!shouldPersistProjectThread(next, threadRef.current)) {
        return Promise.resolve();
      }
      persistence.setPending(next);
      return flushPending();
    },
    [flushPending, persistence]
  );
  const persistRunMetadata = useCallback(
    (metadata: ThreadRunMetadata): Promise<void> => {
      metadataSaveChain.current = metadataSaveChain.current
        .catch(() => undefined)
        .then(async () => {
          const current = threadRef.current;
          await Promise.all([
            client.saveRunHistory(
              current.id,
              metadata.runHistory.map((run) => run.id)
            ),
            client.saveEvaluationMetadata(
              current.id,
              playgroundThreadToStudioEvaluationMetadata(metadata)
            ),
          ]);
        });
      return metadataSaveChain.current;
    },
    [client]
  );
  const executionRuntime = useMemo(
    () =>
      createProjectThreadExecutionRuntime({
        client,
        projectId,
        threadId: thread.id,
        getThread: () => threadRef.current,
        onThread: publishThread,
        beforeAdmission: flushPending,
        onSettled: async () => {
          await flushPending();
          await controller.refresh();
        },
      }),
    [client, controller, flushPending, projectId, publishThread, thread.id]
  );
  return (
    <ThreadPlayground
      active
      className="min-h-0 flex-1"
      definitionReadonly
      modelSelectionReadonly={false}
      executionRuntime={executionRuntime}
      runChangePersistence="runtime"
      sharingEnabled={false}
      initialValue={studioThreadToPlaygroundThread(
        thread,
        history,
        evaluationMetadata
      )}
      path={`threads/${thread.id}`}
      storeKey={thread.id}
      title={thread.document.title}
      onChange={(next) => {
        void persist(next).catch((error: unknown) => {
          toast.error("Unable to save Studio Thread", {
            description: _errorMessage(error),
          });
        });
      }}
      onRunMetadataChange={(metadata) => {
        void persistRunMetadata(metadata).catch((error: unknown) => {
          toast.error("Unable to save Run metadata", {
            description: _errorMessage(error),
          });
        });
      }}
      onRenameTitle={async (title) => {
        const current = threadRef.current;
        try {
          const saved = await client.saveDocument(current.id, {
            ...current.document,
            title,
          });
          publishThread(saved);
          return true;
        } catch (error) {
          toast.error("Unable to rename Studio Thread", {
            description: _errorMessage(error),
          });
          return false;
        }
      }}
    />
  );
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
