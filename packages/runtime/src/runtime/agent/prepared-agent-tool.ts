import type { AgentTool } from "@earendil-works/pi-agent-core";

type PreparedAgentToolDefinition = Omit<AgentTool, "execute">;

type PreparedAgentToolOutcome =
  | {
      readonly type: "completed";
      readonly result: Awaited<ReturnType<AgentTool["execute"]>>;
    }
  | { readonly type: "deferred" };

export type PreparedAgentTool =
  | {
      readonly kind: "executable";
      readonly definition: PreparedAgentToolDefinition;
      readonly execute: (
        ...args: Parameters<AgentTool["execute"]>
      ) => Promise<PreparedAgentToolOutcome>;
    }
  | {
      readonly kind: "deferred";
      readonly definition: PreparedAgentToolDefinition;
    };
