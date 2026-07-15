import type { BuiltinTool, McpTool, ProjectTool } from "@llm-space/core";

import { callBuiltInTool } from "@/client/built-in-tools";
import { callMcpTool } from "@/client/mcp";
import { electrobun } from "@/lib/electrobun";

/**
 * A tool call's result, normalized across the two backends. MCP surfaces
 * `isError` on the response; built-in tools signal failure by throwing, so a
 * successful built-in result is always `isError: false`.
 */
export interface ToolCallResult {
  contentText: string;
  isError: boolean;
}

export interface ToolExecutionContext {
  messageId?: string;
  toolCallId?: string;
  attemptAt?: string;
}

export type ToolExecutor = (
  tool: McpTool | BuiltinTool | ProjectTool,
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) => Promise<ToolCallResult>;

/**
 * The single dispatch point for invoking an executable tool. Callers gate on
 * {@link isExecutableTool} so `function` tools never reach here.
 */
export async function executeTool(
  tool: McpTool | BuiltinTool | ProjectTool,
  args: Record<string, unknown>,
  context: ToolExecutionContext & { threadId?: string } = {}
): Promise<ToolCallResult> {
  if (tool.type === "mcp") {
    const result = await callMcpTool({
      serverId: tool.serverId,
      toolName: tool.toolName,
      arguments: args,
    });
    return {
      contentText: result.contentText,
      isError: result.isError ?? false,
    };
  }
  if (tool.type === "project") {
    if (!electrobun.rpc) throw new Error("Desktop RPC is not available.");
    return electrobun.rpc.request.externalAgentProjectCallTool({
      projectId: tool.projectId,
      threadId: context.threadId,
      snapshot: tool.snapshot,
      name: tool.name,
      arguments: args,
      messageId: context.messageId,
      toolCallId: context.toolCallId,
      attemptAt: context.attemptAt,
    });
  }
  const result = await callBuiltInTool({ name: tool.name, arguments: args });
  return { contentText: result.contentText, isError: false };
}
