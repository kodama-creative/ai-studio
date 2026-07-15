import { isExecutableTool, type Tool, type ToolCall } from "@llm-space/core";
import { useCallback, useMemo } from "react";

import { ProjectToolCallRejectedError } from "@/client/project-tool-call-rejected-error";
import { isFirecrawlLimitError } from "@/lib/firecrawl";
import { useThreadStore, useThreadStoreActions } from "../stores";
import { useToolExecutor } from "../tool-execution-context";

export interface ToolCallOutcome {
  isError: boolean;
  isFirecrawlLimit: boolean;
}

/**
 * The single home for "call a tool and record its result". Resolves the tool by
 * name, executes it, writes the output back to the store, and classifies
 * Firecrawl-limit errors. Error *reporting* (single toast vs. bulk aggregate)
 * stays at the call site — only detection and plumbing are shared here.
 */
export function useToolCallRunner(messageId: string) {
  const tools = useThreadStore(state => state.thread.context?.tools);
  const {
    continueAfterProjectToolResult,
    markToolCallAttempt,
    updateToolCallOutputText
  } = useThreadStoreActions();
  const executeTool = useToolExecutor();

  const toolsByName = useMemo(
    () => new Map((tools ?? []).map(tool => [tool.name, tool])),
    [tools]
  );
  const resolveTool = useCallback(
    (name: string): Tool | undefined => toolsByName.get(name),
    [toolsByName]
  );

  const runToolCall = useCallback(
    async (toolCall: ToolCall): Promise<ToolCallOutcome | null> => {
      const tool = resolveTool(toolCall.input.name);
      if (!tool || !isExecutableTool(tool)) {
        return null;
      }
      const isRemoteProjectTool =
        tool.type === "project" && Boolean(tool.connectionName);
      try {
        const attempt = isRemoteProjectTool
          ? {
            messageId,
            toolCallId: toolCall.id,
            at: new Date().toISOString()
          }
          : undefined;
        if (attempt) {
          markToolCallAttempt(attempt.messageId, attempt.toolCallId, attempt.at);
        }
        const { contentText, isError } = await executeTool(
          tool,
          toolCall.input.arguments,
          { callId: toolCall.id, attempt }
        );
        updateToolCallOutputText(messageId, toolCall.id, contentText, isError);
        if (isRemoteProjectTool) {
          await continueAfterProjectToolResult(messageId);
        }
        return {
          isError,
          isFirecrawlLimit: isError && isFirecrawlLimitError(contentText)
        };
      } catch (error) {
        const text = error instanceof Error ? error.message : "Tool call failed";
        if (
          isRemoteProjectTool
          && error instanceof ProjectToolCallRejectedError
        ) {
          updateToolCallOutputText(messageId, toolCall.id, text, true);
          await continueAfterProjectToolResult(messageId);
          return {
            isError: true,
            isFirecrawlLimit: isFirecrawlLimitError(text)
          };
        }
        if (isRemoteProjectTool) {
          // A transport failure does not prove the remote side effect failed.
          // Keep only the durable pre-call marker so recovery renders Outcome
          // unknown and never advances the ReAct loop automatically.
          return {
            isError: true,
            isFirecrawlLimit: isFirecrawlLimitError(text)
          };
        }
        updateToolCallOutputText(messageId, toolCall.id, text, true);
        return { isError: true, isFirecrawlLimit: isFirecrawlLimitError(text) };
      }
    },
    [
      executeTool,
      continueAfterProjectToolResult,
      markToolCallAttempt,
      messageId,
      resolveTool,
      updateToolCallOutputText
    ]
  );

  return { resolveTool, runToolCall };
}
