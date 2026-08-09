import type { ToolModelOutput } from "@llm-space/agent/tools";

import type { HarnessPrincipal } from "./harness-principal";

export type { HarnessPrincipal } from "./harness-principal";
export type { SessionCommand } from "./session-command";
export type { SessionCommandReceipt } from "./session-command-receipt";
export type { SessionCommandSource } from "./session-command-source";

export interface HarnessToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface HarnessUserMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: string;
}

export interface HarnessAssistantMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls: readonly HarnessToolCall[];
}

export interface HarnessToolMessage {
  readonly id: string;
  readonly role: "tool";
  readonly callId: string;
  readonly name: string;
  readonly output: ToolModelOutput;
  readonly isError: boolean;
}

export type HarnessMessage =
  HarnessUserMessage | HarnessAssistantMessage | HarnessToolMessage;

export type HarnessSessionStatus =
  "waiting" | "running" | "completed" | "failed";

export interface HarnessSessionSnapshot {
  readonly id: string;
  readonly agentId: string;
  readonly generationId: string;
  readonly mode: "conversation" | "task";
  readonly status: HarnessSessionStatus;
  readonly messages: readonly HarnessMessage[];
  readonly state: Readonly<Record<string, unknown>>;
  /** Initiating identity is persisted; current identity belongs to a command. */
  readonly auth?: {
    readonly initiator: HarnessPrincipal | null;
  };
  readonly turnSequence: number;
  readonly eventSequence: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activeTurnId?: string;
  readonly activeCommandId?: string;
  readonly lastCommand?: {
    readonly commandId: string;
    readonly turnId: string;
    readonly status: "completed" | "cancelled" | "failed";
  };
  readonly error?: string;
}

export type HarnessEventData =
  | {
      readonly type: "session.started";
      readonly agentId: string;
      readonly generationId: string;
    }
  | {
      readonly type: "turn.started";
      readonly commandId: string;
      readonly turnId: string;
      readonly turnSequence: number;
    }
  | {
      readonly type: "message.received";
      readonly turnId: string;
      readonly message: HarnessUserMessage;
    }
  | {
      readonly type: "step.started";
      readonly turnId: string;
      readonly stepIndex: number;
    }
  | {
      readonly type: "message.appended";
      readonly turnId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "message.completed";
      readonly turnId: string;
      readonly message: HarnessAssistantMessage;
    }
  | {
      readonly type: "actions.requested";
      readonly turnId: string;
      readonly calls: readonly HarnessToolCall[];
    }
  | {
      readonly type: "action.result";
      readonly turnId: string;
      readonly callId: string;
      readonly name: string;
      readonly output: ToolModelOutput;
      readonly isError: boolean;
    }
  | {
      readonly type: "step.completed";
      readonly turnId: string;
      readonly stepIndex: number;
    }
  | {
      readonly type: "step.failed";
      readonly turnId: string;
      readonly stepIndex: number;
      readonly message: string;
    }
  | { readonly type: "turn.completed"; readonly turnId: string }
  | { readonly type: "turn.cancelled"; readonly turnId: string }
  | {
      readonly type: "turn.failed";
      readonly turnId: string;
      readonly message: string;
    }
  | { readonly type: "session.waiting" }
  | { readonly type: "session.completed" }
  | { readonly type: "session.failed"; readonly message: string };

export interface HarnessEvent {
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly event: HarnessEventData;
}

export interface SessionEventCursor {
  /** Return events whose sequence is greater than this value. */
  readonly afterSequence?: number;
  /** Keep waiting for newly appended events after replaying the current tail. */
  readonly follow?: boolean;
  /** Stops a following read without affecting the harness session. */
  readonly signal?: AbortSignal;
}
