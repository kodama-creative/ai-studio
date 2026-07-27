import type {
  AgentMessage,
  ExecutionEnv,
  StreamFn
} from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

import type { PreparedAgentTool } from "./prepared-agent-tool";
import type { AgentHostApprovalPolicy } from "../../shared/agent-approval-policy";
import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { SessionStore, StoredRuntimeSession } from "../harness/session-store";
import type { SandboxTurnEnvironment } from "../sandbox/sandbox-provider";
import type { AgentSessionEvent, AgentSessionPersistence } from "../sessions/agent-session";

export type AgentSubagentSandboxMode = "direct" | "isolated" | "shared";

export interface AgentSubagentRunIdentity {
  readonly runId: string;
  readonly sessionId: string;
}

export interface AgentSubagentRunStart {
  readonly child: AgentSubagentRunIdentity;
  readonly message: string;
  readonly parent: {
    readonly runId: string;
    readonly sessionId: string;
    readonly toolCallId: string;
  };
  readonly sandbox: {
    readonly mode: AgentSubagentSandboxMode;
    readonly revalidationFingerprint?: string;
  };
  readonly subagent: {
    readonly artifactFingerprint: string;
    readonly description: string;
    readonly id: string;
  };
  readonly retryOf?: AgentSubagentRunIdentity;
}

export interface AgentSubagentRunTerminal {
  readonly error?: { readonly code: string; readonly message: string; };
  readonly result?: string;
  readonly status: "cancelled" | "completed" | "failed" | "outcomeUnknown";
}

export interface AgentSubagentRunWait {
  readonly state:
    | "waitingForApproval"
    | "waitingForBudget"
    | "waitingForContinue"
    | "waitingForToolResults";
}

export interface AgentSubagentSessionResources {
  readonly approvalPolicy?: AgentHostApprovalPolicy;
  readonly capabilityPolicy: AgentCapabilityPolicy;
  readonly executionEnv?: ExecutionEnv;
  readonly extraTools?: PreparedAgentTool[];
  readonly initialMessages?: readonly AgentMessage[];
  readonly onSessionCommitted?: (
    session: StoredRuntimeSession
  ) => Promise<void> | void;
  readonly persistence?: AgentSessionPersistence;
  readonly sandbox?: SandboxTurnEnvironment;
  readonly sessionStore?: SessionStore;
  readonly streamFn?: StreamFn;
  readonly resume?:
    | {
      readonly results: readonly ToolResultMessage[];
      readonly type: "resolveToolResults";
    }
    | {
      readonly terminal: AgentSubagentRunTerminal;
      readonly type: "terminal";
    }
    | { readonly type: "continue"; }
    | { readonly type: "park"; readonly wait: AgentSubagentRunWait; }
    | { readonly type: "prompt"; }
    | { readonly type: "resumeApprovedTools"; };
}

export interface AgentSubagentHost {
  prepare(
    start: AgentSubagentRunStart,
    context: AgentSessionContext
  ): AgentSubagentSessionResources | Promise<AgentSubagentSessionResources>;
  handleEvent?(
    identity: AgentSubagentRunIdentity,
    event: AgentSessionEvent
  ): Promise<void> | void;
  park?(
    identity: AgentSubagentRunIdentity,
    wait: AgentSubagentRunWait
  ): Promise<void> | void;
  finish?(
    identity: AgentSubagentRunIdentity,
    terminal: AgentSubagentRunTerminal
  ): Promise<void> | void;
}
