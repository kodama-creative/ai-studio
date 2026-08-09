import type { SessionCommand } from "./protocol";

export type NewSessionCommand = Omit<SessionCommand, "sequence">;

export interface SessionCommandLease {
  readonly command: SessionCommand;
  complete(): Promise<void>;
  release(): Promise<void>;
  renew(leaseExpiresAt: number): Promise<void>;
}

export interface SessionCommandEnqueueResult {
  readonly status: "enqueued" | "duplicate";
  readonly command: SessionCommand;
}

export interface SessionCommandRecovery {
  readonly active: readonly {
    readonly command: SessionCommand;
    readonly leaseExpiresAt: number;
  }[];
  readonly recovered: readonly SessionCommandLease[];
}

/**
 * Durable mailbox seam used by the Harness worker. Implementations must keep
 * FIFO order per Session and make an enqueued command visible to a later host.
 */
export interface SessionCommandQueue {
  enqueue(command: NewSessionCommand): Promise<SessionCommandEnqueueResult>;
  claim(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandLease | undefined>;
  recover(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandRecovery>;
}
