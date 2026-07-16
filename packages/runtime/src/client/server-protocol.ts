import type { AgentEvent } from "@earendil-works/pi-agent-core";

export const AGENT_SERVER_PROTOCOL_SCHEMA_VERSION = 1 as const;

export type ServerRunTerminalOutcome =
  | "cancelled"
  | "completed"
  | "failed"
  | "outcomeUnknown";

export type ServerControlEvent =
  | {
    readonly code?: string;
    readonly outcome: ServerRunTerminalOutcome;
    readonly type: "runTerminal";
  }
  | { readonly retryAfterSeconds: number; readonly type: "serverShutdown"; };

export type AgentServerStreamEvent =
  | {
    readonly data: AgentEvent;
    readonly event: "pi";
    readonly sequence: number;
  }
  | {
    readonly data: Extract<ServerControlEvent, { type: "runTerminal"; }>;
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
