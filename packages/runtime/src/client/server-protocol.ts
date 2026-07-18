import type { AgentEvent } from "@earendil-works/pi-agent-core";

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

export type ServerControlEvent<TValue extends JsonValue = JsonValue> =
  | {
    readonly code?: string;
    readonly outcome: ServerRunTerminalOutcome;
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
    readonly data: Extract<ServerControlEvent, { type: "serverShutdown"; }>;
    readonly event: "control";
    readonly sequence: null;
  }
  | {
    readonly data: Extract<ServerControlEvent<TValue>, { type: "runTerminal"; }>;
    readonly event: "control";
    readonly sequence: number;
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
