import type { AssistantMessage, Message } from "@llm-space/core";

import type { AgentSnapshot } from "./agent";

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type RunExecutionMode = "step" | "continue";

export interface RunControl {
  /** Whether the next Worker claim executes one step or runs until completion. */
  readonly mode: RunExecutionMode;
  /** Studio-only static model used for every model step in this Run. */
  readonly modelOverride?: string;
  /** Optional pending tool selected by the Studio's manual tool runner. */
  readonly toolCallId?: string;
}

export interface RunPause {
  readonly reason: "step.completed";
  readonly step: "model.completed" | "tool.completed";
  readonly checkpointId: string;
  readonly pausedAt: number;
}

export interface RunError {
  readonly code?: string;
  readonly message: string;
}

/** One user-triggered durable attempt to execute a complete Agent loop on one Thread. */
export interface Run {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly threadId: string;
  readonly operationId: string;
  readonly retryOfRunId?: string;
  /** Model-visible Messages materialized from the single input that started this Run. */
  readonly inputMessages: readonly Message[];
  readonly baseCheckpointId: string;
  readonly inputCheckpointId: string;
  readonly agentSnapshot: AgentSnapshot;
  /** Durable execution intent consumed by the Worker on every claim. */
  readonly control: RunControl;
  readonly status: RunStatus;
  readonly pause?: RunPause;
  readonly resultCheckpointId?: string;
  readonly error?: RunError;
  readonly workerId?: string;
  readonly leaseExpiresAt?: number;
  readonly cancelRequestedAt?: number;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface RunOutputSnapshot {
  readonly runId: string;
  readonly message: AssistantMessage;
  readonly status: "streaming" | "completed";
  readonly updatedAt: number;
}

export type RunEventData =
  | { readonly type: "run.updated"; readonly run: Run }
  | {
      readonly type: "message.delta";
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "thinking.delta";
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "message.completed";
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "tool.started";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool.completed";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "tool.updated";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "checkpoint.committed";
      readonly checkpointId: string;
      readonly reason: "input" | "step" | "recovery" | "manual";
    };

export interface RunEvent {
  readonly runId: string;
  readonly cursor: number;
  readonly timestamp: number;
  readonly event: RunEventData;
}

export type RunFrame =
  | {
      readonly type: "snapshot";
      readonly cursor: number;
      readonly run: Run;
      readonly outputs: readonly RunOutputSnapshot[];
      readonly headCheckpointId: string;
    }
  | {
      readonly type: "event";
      readonly cursor: number;
      readonly event: RunEventData;
    };

export interface RunEventCursor {
  readonly afterCursor?: number;
  readonly follow?: boolean;
  readonly signal?: AbortSignal;
}
