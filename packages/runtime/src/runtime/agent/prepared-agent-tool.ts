import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { ExecutionEnvToolKind } from "../../public/definitions/execution-env-tool";

type PreparedAgentToolDefinition = Omit<AgentTool, "execute">;

type PreparedAgentToolOutcome =
  | {
    readonly result: Awaited<ReturnType<AgentTool["execute"]>>;
    readonly type: "completed";
  }
  | { readonly type: "deferred"; };

export interface PreparedAgentToolProvenance {
  readonly connectionName?: string;
  readonly contributionId: string;
  readonly schemaFingerprint?: string;
  readonly sourcePath?: string;
}

export type PreparedAgentTool =
  | {
    readonly definition: PreparedAgentToolDefinition;
    readonly execute: (
      ...args: Parameters<AgentTool["execute"]>
    ) => Promise<PreparedAgentToolOutcome>;
    readonly executionEnvToolKind?: ExecutionEnvToolKind;
    readonly kind: "executable";
    readonly manualAutomatic?: boolean;
    readonly provenance?: PreparedAgentToolProvenance;
  }
  | {
    readonly definition: PreparedAgentToolDefinition;
    readonly executionEnvToolKind?: ExecutionEnvToolKind;
    readonly kind: "deferred";
    readonly provenance?: PreparedAgentToolProvenance;
  };
