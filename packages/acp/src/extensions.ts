import type { AgentCapabilities } from "@agentclientprotocol/sdk/experimental/v2";

export const LLM_SPACE_ACP_METHODS = {
  snapshot: "_llm-space.dev/session/snapshot",
  step: "_llm-space.dev/session/step",
  continue: "_llm-space.dev/session/continue",
} as const;

/** Advertises Pi-backed debugger control without claiming ACP standard support. */
export function createLlmSpaceAgentCapabilities(): AgentCapabilities {
  return {
    session: {},
    _meta: {
      "llm-space.dev": {
        durableDebug: {
          version: 1,
          cursor: "pi-log-sequence",
          methods: [
            LLM_SPACE_ACP_METHODS.snapshot,
            LLM_SPACE_ACP_METHODS.step,
            LLM_SPACE_ACP_METHODS.continue,
          ],
        },
      },
    },
  };
}
