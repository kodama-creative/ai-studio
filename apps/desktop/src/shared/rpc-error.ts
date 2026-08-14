import type { JsonObject } from "@llm-space/core";

export type RpcErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CAPABILITY_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "CANCELLED"
  | "INTERNAL";

/** Stable error data allowed to cross the native RPC seam. */
export interface RpcError {
  readonly code: RpcErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
}

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcError };

/** Known domain failure that can be safely serialized for a client. */
export class RpcDomainError extends Error {
  /** Preserve one explicitly safe domain error for the transport mapper. */
  constructor(readonly rpcError: RpcError) {
    super(rpcError.message);
    this.name = "RpcDomainError";
  }
}

/** Client-side exception retaining the stable cross-process error identity. */
export class RpcClientError extends Error {
  readonly code: RpcErrorCode;
  readonly details?: JsonObject;

  /** Rehydrate stable error identity on the renderer side. */
  constructor(error: RpcError) {
    super(error.message);
    this.name = "RpcClientError";
    this.code = error.code;
    this.details = error.details;
  }
}
