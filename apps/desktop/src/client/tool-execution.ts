import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  McpTool,
} from "@llm-space/core";
import type { ExecuteToolOptions } from "@llm-space/ui/host";

import type { McpClient } from "@/client/mcp";
import type { BuiltinToolsRequests } from "@/shared/builtin-tools-rpc";

/**
 * A tool call's result, normalized across MCP and built-in backends.
 * MCP surfaces `isError` on the response; the local backends signal failure by
 * throwing, so a successful local result is always `isError: false`.
 */
export interface ToolCallResult extends BuiltinToolCallResponse {
  isError: boolean;
}

/**
 * The single dispatch point for invoking an executable tool. Callers gate on
 * {@link isExecutableTool} so `function` tools never reach here.
 */
export function createToolExecutor(
  mcp: Pick<McpClient, "callTool">,
  builtinTools: Pick<BuiltinToolsRequests, "call">
): (
  tool: McpTool | BuiltinTool,
  args: Record<string, unknown>,
  options: ExecuteToolOptions
) => Promise<ToolCallResult> {
  return async (tool, args, options) => {
    if (tool.type === "mcp") {
      const result = await mcp.callTool({
        serverId: tool.serverId,
        toolName: tool.toolName,
        arguments: args,
      });
      return {
        content: result.content,
        isError: result.isError ?? false,
      };
    }
    const result = await builtinTools.call({
      name: tool.name,
      arguments: args,
      config: tool.config,
      connection: options.connection,
    });
    return {
      content: result.content,
      isError: false,
    };
  };
}
