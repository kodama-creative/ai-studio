import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  McpTool,
} from "@llm-space/core";
import type { ExecuteToolOptions } from "@llm-space/ui/host";

import type { BuiltinToolsRequests } from "@/shared/builtin-tools-rpc";
import type { McpRequests } from "@/shared/mcp-rpc";

/** A tool result normalized across MCP and bundled-tool Services. */
export interface ToolCallResult extends BuiltinToolCallResponse {
  isError: boolean;
}

/** Dispatch one executable tool to its injected remote Service. */
export function createToolExecutor(
  mcp: Pick<McpRequests, "callTool">,
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
