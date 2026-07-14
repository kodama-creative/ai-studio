import type { AgentTool } from "@earendil-works/pi-agent-core";

export const DEFERRED_TOOL_RESULT_MARKER = "llm-space-runtime-deferred";

const RUNTIME_DEFERRED_TOOL = Symbol("llm-space-runtime-deferred-tool");

export type RuntimeDeferredAgentTool = AgentTool & {
  [RUNTIME_DEFERRED_TOOL]: true;
};

export function createDeferredAgentTool(
  tool: Omit<AgentTool, "execute">
): AgentTool {
  return {
    ...tool,
    [RUNTIME_DEFERRED_TOOL]: true,
    execute() {
      return Promise.resolve({
        content: [{ type: "text", text: "" }],
        details: { marker: DEFERRED_TOOL_RESULT_MARKER },
        terminate: true,
      });
    },
  } as RuntimeDeferredAgentTool;
}

export function isRuntimeDeferredTool(
  tool: AgentTool
): tool is RuntimeDeferredAgentTool {
  return RUNTIME_DEFERRED_TOOL in tool;
}
