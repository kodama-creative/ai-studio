export type RunOwner =
  | { readonly type: "session"; readonly sessionId: string }
  | { readonly type: "thread"; readonly threadId: string };

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunError {
  readonly message: string;
  readonly code?: string;
}

export interface Run {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly owner: RunOwner;
  readonly triggerMessageId: string;
  readonly status: RunStatus;
  readonly resultCheckpointId?: string;
  readonly usage?: Readonly<Record<string, number>>;
  readonly error?: RunError;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
}
