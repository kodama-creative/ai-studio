import type {
  PromptRequest,
  UpdateSessionNotification,
} from "@llm-space/acp/protocol";
import type { SharedSessionUpdate } from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";

export const ACP_SESSION_SERVICE = Symbol("AcpSessionService");

/** Product identity stays outside ACP; the backend resolves its owned Session. */
export type AcpSessionTarget =
  | { readonly kind: "playground"; readonly playgroundId: string }
  | {
      readonly kind: "experiment";
      readonly projectId: string;
      readonly experimentId: string;
    };

export interface AcpPromptCommand {
  readonly request: PromptRequest;
  /** Committed ACP upserts preceding the current PromptRequest user message. */
  readonly context: readonly SharedSessionUpdate[];
  readonly messageId: string;
  readonly mode: "step" | "turn" | "continue";
  readonly modelOverride?: string;
  readonly signal?: AbortSignal;
}

export interface AcpActionCommand {
  readonly operationId: string;
  readonly expectedActionId: string;
  readonly kind: "model" | "tool";
  readonly signal?: AbortSignal;
}

export interface AcpPermissionCommand {
  readonly operationId: string;
  readonly expectedActionId: string;
  readonly toolCallId: string;
  readonly optionId: "allow_once" | "reject_once";
  readonly resumeMode: "step" | "continue";
  readonly signal?: AbortSignal;
}

export interface AcpSessionRpc {
  readonly requests: AcpSessionRequests;
  readonly streams: AcpSessionStreams;
  readonly events: Record<never, never>;
}

export interface AcpSessionRequests {
  prompt(target: AcpSessionTarget, input: AcpPromptCommand): Promise<void>;
  step(target: AcpSessionTarget, input: AcpActionCommand): Promise<void>;
  turn(target: AcpSessionTarget, input: AcpActionCommand): Promise<void>;
  continue(
    target: AcpSessionTarget,
    input: { readonly operationId: string; readonly signal?: AbortSignal }
  ): Promise<void>;
  requestPermission(
    target: AcpSessionTarget,
    input: AcpPermissionCommand
  ): Promise<void>;
  cancel(target: AcpSessionTarget): Promise<void>;
}

export interface AcpSessionStreams {
  updates(
    target: AcpSessionTarget,
    input?: { readonly afterCursor?: number; readonly signal?: AbortSignal }
  ): AsyncIterable<UpdateSessionNotification>;
}

export type AcpSessionClient = AcpSessionRequests & AcpSessionStreams;

export const ACP_SESSION_RPC = defineRpcNamespace<AcpSessionRpc>(
  "acpSession",
  {
    requests: {
      prompt: true,
      step: true,
      turn: true,
      continue: true,
      requestPermission: true,
      cancel: true,
    },
    streams: { updates: true },
    events: {},
  }
);
