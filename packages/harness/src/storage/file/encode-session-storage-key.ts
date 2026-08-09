export function encodeSessionStorageKey(sessionId: string): string {
  return Buffer.from(sessionId).toString("base64url");
}
