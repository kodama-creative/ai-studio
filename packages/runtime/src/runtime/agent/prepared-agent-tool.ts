import type { AgentTool } from "@earendil-works/pi-agent-core";

type PreparedAgentToolDefinition = Omit<AgentTool, "execute">;

type PreparedAgentToolOutcome =
  | {
    readonly result: Awaited<ReturnType<AgentTool["execute"]>>;
    readonly type: "completed";
  }
  | { readonly type: "deferred"; };

export type PreparedAgentTool =
  | {
    readonly definition: PreparedAgentToolDefinition;
    readonly execute: (
      ...args: Parameters<AgentTool["execute"]>
    ) => Promise<PreparedAgentToolOutcome>;
    readonly kind: "executable";
  }
  | {
    readonly definition: PreparedAgentToolDefinition;
    readonly kind: "deferred";
  };
