import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type {
  PiOperationSnapshot,
  PiSessionSnapshot,
} from "@llm-space/pi-runtime";

export const APP_PI_LANE = "main" as const;
export const APP_PI_RUNTIME_FORMAT_VERSION = 1 as const;

/** App-owned metadata that references, but never duplicates, one Pi Session. */
export interface AppSessionRecord {
  readonly schemaVersion: 2;
  readonly sessionId: string;
  readonly projectId?: string;
  readonly agentId: string;
  readonly status: "active" | "archived";
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Product Session facade composed from App metadata and current Pi facts. */
export interface Session extends AppSessionRecord {
  readonly lane: typeof APP_PI_LANE;
  readonly name: string;
  readonly leafId: string | null;
  readonly operationId?: string;
  readonly runtimeFormatVersion: typeof APP_PI_RUNTIME_FORMAT_VERSION;
}

/** App exposes Pi entries directly; it does not persist a model transcript. */
export type SessionEntry = Extract<Entry, { type: "message" | "custom" }>;

/** Product workflow metadata referencing its current Pi operation. */
export interface Task {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly sessionId: string;
  readonly title: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly operationId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Product-owned committed-log cursor for one Pi-backed Session. */
export interface SessionInspectInput {
  readonly sessionId: string;
  readonly lane?: string;
  readonly afterSeq?: number;
}

export interface SessionStepInput extends SessionInspectInput {
  readonly expectedActionId: string;
  readonly kind: "model" | "tool";
}

export type SessionTurnInput = SessionStepInput;
export type SessionContinueInput = SessionInspectInput;

/** Final machine-readable result returned by App and `llm-space exec`. */
export interface AgentExecutionResult {
  readonly schemaVersion: 2;
  readonly sessionId: string;
  readonly operation: PiOperationSnapshot;
  readonly snapshot: PiSessionSnapshot;
  readonly messages: readonly AgentMessage[];
}
