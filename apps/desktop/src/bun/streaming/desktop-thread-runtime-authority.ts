import {
  convertFromPiMessages,
  normalizeThread,
  type Thread
} from "@llm-space/core";
import {
  InMemorySessionStore,
  type SessionStore,
  type SessionStoreCommit,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionPersistence } from "@llm-space/runtime/node";

export interface DesktopThreadFileAdapter {
  read(): Promise<Thread>;
  write(thread: Thread): Promise<void>;
}

export interface DesktopThreadRuntimeAuthority {
  readonly persistence: AgentSessionPersistence;
  readonly session: StoredRuntimeSession;
  readonly sessionStore: SessionStore;
  reconcileInitialMessages(messages: AgentMessage[]): AgentMessage[];
}

/**
 * Deepens one Desktop Thread file into the single durable authority for its
 * Pi transcript and Runtime Session. Both mutation classes share one write
 * tail so a transcript boundary cannot race a Session Store checkpoint.
 */
export async function createDesktopThreadRuntimeAuthority(
  adapter: DesktopThreadFileAdapter
): Promise<DesktopThreadRuntimeAuthority> {
  const initial = await adapter.read();
  const persisted = initial.runtimeSession as StoredRuntimeSession | undefined;
  if (!persisted) {
    throw new Error("Desktop Thread has no active Runtime Session.");
  }
  const validated = await new InMemorySessionStore([persisted]).load(
    persisted.snapshot.id
  );
  if (!validated) {
    throw new Error("Desktop Thread Runtime Session could not be loaded.");
  }

  let mutationTail = Promise.resolve();
  const exclusive = async <T>(mutation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(mutation);
    mutationTail = result.then(() => {}, () => {});
    return result;
  };
  const sessionId = validated.snapshot.id;
  const sessionStore: SessionStore = {
    load: async requestedId => await exclusive(async () => {
      if (requestedId !== sessionId) { return null; }
      const current = await adapter.read();
      const runtime = current.runtimeSession as StoredRuntimeSession | undefined;
      if (!runtime) { return null; }
      return new InMemorySessionStore([runtime]).load(requestedId);
    }),
    commit: async input => await exclusive(async () => {
      _assertSessionId(sessionId, input);
      const current = await adapter.read();
      const runtime = current.runtimeSession as StoredRuntimeSession | undefined;
      const memory = new InMemorySessionStore(runtime ? [runtime] : []);
      const committed = await memory.commit(input);
      await adapter.write(normalizeThread({
        ...current,
        runtimeSession: committed
      }));
      return committed;
    })
  };
  const persistence: AgentSessionPersistence = {
    replaceMessages: async messages => {
      await exclusive(async () => {
        const current = await adapter.read();
        await adapter.write(normalizeThread({
          ...current,
          context: {
            ...current.context,
            messages: convertFromPiMessages(
              messages,
              current.context?.messages ?? [],
              current.sandboxAttachments
            )
          }
        }));
      });
    }
  };

  return {
    persistence,
    session: validated,
    sessionStore,
    reconcileInitialMessages(messages) {
      const activeRunId = validated.snapshot.activeRunId;
      const activeStep = validated.snapshot.operationLedger?.steps.find(
        step => step.runId === activeRunId && step.state === "active"
      );
      if (!activeStep) { return messages; }
      if (activeStep.operations.some(operation => operation.state === "parked")) {
        return messages;
      }
      if (activeStep.transcriptMessageCount > messages.length) {
        throw new Error(
          `Desktop Thread transcript is shorter than durable Step ${activeStep.id}`
        );
      }
      return messages.slice(0, activeStep.transcriptMessageCount);
    }
  };
}

function _assertSessionId(
  sessionId: string,
  input: SessionStoreCommit
): void {
  if (input.sessionId !== sessionId) {
    throw new Error("Desktop Thread Runtime Session identity changed.");
  }
}
