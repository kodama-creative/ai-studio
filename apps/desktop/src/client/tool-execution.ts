import type { BuiltinTool, McpTool, ProjectTool } from "@llm-space/core";

import { callBuiltInTool } from "@/client/built-in-tools";
import { callMcpTool } from "@/client/mcp";
import { electrobun } from "@/lib/electrobun";
import { ProjectToolCallRejectedError } from "./project-tool-call-rejected-error";

import type { RemoteToolCallAttempt } from "@/shared/external-agent-project";

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
  callId?: string;
  attempt?: RemoteToolCallAttempt;
}

export type ToolExecutor = (
  tool: BuiltinTool | McpTool | ProjectTool,
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) => Promise<ToolCallResult>;

/**
 * The single dispatch point for invoking an executable tool. Callers gate on
 * {@link isExecutableTool} so `function` tools never reach here.
 */
export async function executeTool(
  tool: BuiltinTool | McpTool | ProjectTool,
  args: Record<string, unknown>,
  context: { threadId?: string; } & ToolExecutionContext = {}
): Promise<ToolCallResult> {
  if (tool.type === "mcp") {
    const result = await callMcpTool({
      serverId: tool.serverId,
      toolName: tool.toolName,
      arguments: args
    });
    return {
      contentText: result.contentText,
      isError: result.isError ?? false
    };
  }
  if (tool.type === "project") {
    if (!electrobun.rpc) { throw new Error("Desktop RPC is not available."); }
    if (!context.callId) {
      throw new Error("Project tool calls require the model tool-call id.");
    }
    const result = await electrobun.rpc.request.externalAgentProjectCallTool({
      projectId: tool.projectId,
      threadId: context.threadId,
      snapshot: tool.snapshot,
      name: tool.name,
      callId: context.callId,
      arguments: args,
      attempt: context.attempt
    });
    if ("rejected" in result) {
      throw new ProjectToolCallRejectedError(result.message);
    }
    return result;
  }
  const result = await callBuiltInTool({ name: tool.name, arguments: args });
  return { contentText: result.contentText, isError: false };
}
