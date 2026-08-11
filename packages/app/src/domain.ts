import type { Message } from "@llm-space/core";

/** Stable product entry point. `threadId` is the default continuation Thread. */
export interface Session {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly projectId?: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionMessageBase {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: number;
}

/** Durable transcript entry projected from a model-facing core Message. */
export interface ModelSessionMessage extends SessionMessageBase {
  readonly type: "model";
  readonly threadId: string;
  readonly runId?: string;
  readonly message: Message;
}

/** Product/system timeline entry that is never sent to the model implicitly. */
export interface SystemSessionMessage extends SessionMessageBase {
  readonly type: "system";
  readonly code: string;
  readonly text: string;
}

/** Auditable user behavior outside the model conversation. */
export interface UserActionSessionMessage extends SessionMessageBase {
  readonly type: "user-action";
  readonly action: string;
  readonly detail?: string;
}

export type SessionMessage =
  ModelSessionMessage | SystemSessionMessage | UserActionSessionMessage;

export interface Task {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Application-owned association; Run itself remains owned only by Engine Thread. */
export interface SessionRunLink {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly taskId?: string;
  readonly createdAt: number;
}

interface ApplicationRunIntentBase {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly sessionId: string;
  readonly taskId?: string;
  readonly createdAt: number;
}

/** Durable command marker used to reconcile an Engine Run after a host crash. */
export type ApplicationRunIntent =
  | (ApplicationRunIntentBase & {
      readonly type: "start";
      readonly message: Extract<Message, { role: "user" }>;
    })
  | (ApplicationRunIntentBase & {
      readonly type: "retry";
      readonly retryOfRunId: string;
    });
