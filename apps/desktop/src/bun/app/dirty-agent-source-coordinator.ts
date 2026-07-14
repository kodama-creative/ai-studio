export type DirtyAgentSourceCloseReason = "quit" | "reload";

export function createDirtyAgentSourceCoordinator({
  sendRequest,
}: {
  sendRequest: (request: {
    requestId: string;
    reason: DirtyAgentSourceCloseReason;
  }) => void;
}) {
  let dirty = false;
  let pending: { requestId: string; onDiscard: () => void } | undefined;

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
      if (pending) return;
      const requestId = crypto.randomUUID();
      pending = { requestId, onDiscard };
      sendRequest({ requestId, reason });
    },
    resolve(requestId: string, discard: boolean): void {
      if (pending?.requestId !== requestId) return;
      const request = pending;
      pending = undefined;
      if (!discard) return;
      dirty = false;
      request.onDiscard();
    },
  };
}
