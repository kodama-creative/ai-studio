import type { AgentEvent } from "@earendil-works/pi-agent-core";

import type {
  RuntimeSessionBudgetWaitSnapshot,
  StoredRuntimeSession
} from "../runtime/harness/session-store";

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
    readonly budget: RuntimeSessionBudgetWaitSnapshot;
    readonly session: StoredRuntimeSession;
    readonly type: "sessionBudgetRequired";
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

export function isRuntimeSessionBudgetWaitSnapshot(
  value: unknown
): value is RuntimeSessionBudgetWaitSnapshot {
  if (!_record(value)) { return false; }
  return typeof value.agentSnapshotFingerprint === "string"
    && _tokenPair(value.baseline)
    && typeof value.id === "string"
    && _tokenPair(value.lifetime)
    && _record(value.limits)
    && _validLimit(value.limits.maxInputTokensPerSession)
    && _validLimit(value.limits.maxModelCallsPerRun)
    && _validLimit(value.limits.maxOutputTokensPerSession)
    && Object.keys(value.limits).every(key =>
      key === "maxInputTokensPerSession"
      || key === "maxModelCallsPerRun"
      || key === "maxOutputTokensPerSession")
    && Array.isArray(value.reached)
    && value.reached.length > 0
    && value.reached.length <= 2
    && value.reached.every(axis => axis === "input" || axis === "output")
    && typeof value.runId === "string"
    && (
      value.status === "granted"
      || value.status === "stopped"
      || value.status === "waiting"
    )
    && _token(value.unmeteredProviderCalls)
    && _tokenPair(value.window)
    && value.lifetime.input - value.baseline.input === value.window.input
    && value.lifetime.output - value.baseline.output === value.window.output;
}

function _record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function _token(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function _tokenPair(
  value: unknown
): value is { readonly input: number; readonly output: number; } {
  return _record(value) && _token(value.input) && _token(value.output);
}

function _validLimit(value: unknown): boolean {
  return value === undefined
    || value === false
    || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}
