import type {
  SessionUpdate,
  UpdateSessionNotification,
} from "@agentclientprotocol/sdk/experimental/v2";

/** Builds deterministic protocol fixtures without exposing server internals. */
export function createAcpSessionNotifications(
  sessionId: string,
  updates: readonly SessionUpdate[],
  cursor = 0
): UpdateSessionNotification[] {
  return updates.map((update) => ({
    sessionId,
    update,
    _meta: { "llm-space.dev": { cursor } },
  }));
}
