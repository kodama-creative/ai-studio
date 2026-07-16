import { ServerHiddenSessionError } from "./server-hidden-session-error";
import { ServerSessionRepository } from "./server-session-repository";

import type { ServerPrincipal } from "../auth/server-authenticator";

/** Revoke one stopped Server repository credential without loading Agent code. */
export async function revokeStoredServerContinuation(options: {
  readonly artifactFingerprint: string;
  readonly continuationToken: string;
  readonly owner: ServerPrincipal;
  readonly repositoryRoot: string;
  readonly sessionId: string;
}): Promise<"alreadyInactive" | "revoked"> {
  const repository = await ServerSessionRepository.open({
    artifactFingerprint: options.artifactFingerprint,
    root: options.repositoryRoot
  });
  try {
    await repository.revokeContinuation({
      continuationToken: options.continuationToken,
      owner: options.owner,
      sessionId: options.sessionId
    });
    return "revoked";
  } catch (error) {
    if (error instanceof ServerHiddenSessionError) {
      return "alreadyInactive";
    }
    throw error;
  } finally {
    await repository.close();
  }
}
