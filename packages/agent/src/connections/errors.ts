export class ConnectionAuthorizationRequiredError extends Error {}
export class ConnectionAuthorizationFailedError extends Error {}

export const isConnectionAuthorizationRequiredError = (
  error: unknown
): error is ConnectionAuthorizationRequiredError =>
  error instanceof ConnectionAuthorizationRequiredError;

export const isConnectionAuthorizationFailedError = (
  error: unknown
): error is ConnectionAuthorizationFailedError =>
  error instanceof ConnectionAuthorizationFailedError;
