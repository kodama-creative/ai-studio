export type DirtyAgentSourceCloseReason = "quit" | "reload";

export function createDirtyAgentSourceCoordinator({
  sendRequest
}: {
  sendRequest: (request: {
    reason: DirtyAgentSourceCloseReason;
    requestId: string;
  }) => void;
}) {
  let dirty = false;
  let pending: { onDiscard: () => void; requestId: string; } | undefined;

  return {
    get dirty(): boolean {
      return dirty;
    },
    setDirty(next: boolean): void {
      dirty = next;
    },
    request(reason: DirtyAgentSourceCloseReason, onDiscard: () => void): void {
      if (!dirty) {
        onDiscard();
        return;
      }
      if (pending) {
        return;
      }
      const requestId = crypto.randomUUID();
      pending = { requestId, onDiscard };
      sendRequest({ requestId, reason });
    },
    resolve(requestId: string, discard: boolean): void {
      if (pending?.requestId !== requestId) {
        return;
      }
      const request = pending;
      pending = undefined;
      if (!discard) {
        return;
      }
      dirty = false;
      request.onDiscard();
    }
  };
}
