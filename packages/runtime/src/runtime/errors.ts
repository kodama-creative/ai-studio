import type { RuntimeCapability, RuntimeId } from "./types";

export class RuntimeNotFoundError extends Error {
  /** Identify the missing Runtime without relying on message parsing. */
  constructor(readonly runtimeId: RuntimeId) {
    super(`Runtime not found: ${runtimeId}`);
    this.name = "RuntimeNotFoundError";
  }
}

export class RuntimeCapabilityUnavailableError extends Error {
  /** Identify an existing Runtime that cannot serve one capability module. */
  constructor(
    readonly runtimeId: RuntimeId,
    readonly capability: RuntimeCapability
  ) {
    super(`Runtime "${runtimeId}" does not support capability "${capability}".`);
    this.name = "RuntimeCapabilityUnavailableError";
  }
}
