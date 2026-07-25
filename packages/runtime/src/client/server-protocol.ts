import type { AgentEvent } from "@earendil-works/pi-agent-core";

import type { StoredRuntimeSession } from "../runtime/harness/session-store";

export const AGENT_SERVER_PROTOCOL_SCHEMA_VERSION = 1 as const;

export type JsonValue =
  | { readonly [key: string]: JsonValue; }
  | boolean
  | number
  | readonly JsonValue[]
  | string
  | null;

export interface ServerStructuredOutput<TValue extends JsonValue = JsonValue> {
  readonly contract: string;
  readonly schemaFingerprint: string;
  readonly value: TValue;
}

export type ServerRunTerminalOutcome =
  | "cancelled"
  | "completed"
  | "failed"
  | "outcomeUnknown";

export interface AgentServerRuntimeWorkingBase {
  readonly branchId: string;
  readonly checkpointId: string;
}

export interface AgentServerRuntimeProjection {
  readonly branchId: string;
  readonly checkpointId: string;
  readonly session: StoredRuntimeSession;
}

export type ServerControlEvent<TValue extends JsonValue = JsonValue> =
  | {
    readonly approvals: ReadonlyArray<{
      readonly id: string;
      readonly reason?: string;
      readonly scope: "call" | "session";
      readonly toolCallId: string;
      readonly toolName: string;
    }>;
    readonly type: "toolApprovalRequired";
  }
  | {
    readonly code?: string;
    readonly outcome: ServerRunTerminalOutcome;
    readonly runtime?: AgentServerRuntimeProjection;
    readonly structuredOutput?: ServerStructuredOutput<TValue>;
    readonly type: "runTerminal";
  }
  | { readonly retryAfterSeconds: number; readonly type: "serverShutdown"; };

export type AgentServerStreamEvent<TValue extends JsonValue = JsonValue> =
  | {
    readonly data: AgentEvent;
    readonly event: "pi";
    readonly sequence: number;
  }
  | {
    readonly data: Exclude<
      ServerControlEvent<TValue>,
      { type: "serverShutdown"; }
    >;
    readonly event: "control";
    readonly sequence: number;
  }
  | {
    readonly data: Extract<ServerControlEvent, { type: "serverShutdown"; }>;
    readonly event: "control";
    readonly sequence: null;
  };

export interface AgentServerSession {
  readonly continuation: {
    readonly expiresAt: string;
    readonly generation: number;
  };
  readonly continuationToken: string;
  readonly schemaVersion: typeof AGENT_SERVER_PROTOCOL_SCHEMA_VERSION;
  readonly sessionId: string;
}

export interface AgentServerRun {
  readonly runId: string;
  readonly schemaVersion: typeof AGENT_SERVER_PROTOCOL_SCHEMA_VERSION;
  readonly sessionId: string;
}

export interface AgentServerContinuation {
  readonly continuation: {
    readonly expiresAt: string;
    readonly generation: number;
  };
  readonly continuationToken: string;
  readonly schemaVersion: typeof AGENT_SERVER_PROTOCOL_SCHEMA_VERSION;
  readonly sessionId: string;
}
