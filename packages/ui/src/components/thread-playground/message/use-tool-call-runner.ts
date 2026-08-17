import { isExecutableTool, type Tool, type ToolCall } from "@llm-space/core";
import { getToolResultText } from "@llm-space/core/thread";
import { useCallback } from "react";

import { isFirecrawlLimitError } from "../../../lib/firecrawl";
import { useThreadStore, useThreadStoreActions } from "../stores";
import { useToolExecutor } from "../tool/use-tool-executor";

export interface ToolCallOutcome {
  isError: boolean;
  isFirecrawlLimit: boolean;
}

/** Decide whether a pending call has either a local or host-owned executor. */
export function canRunToolCall(
  tool: Tool | undefined,
  externalExecutorAvailable: boolean
): boolean {
  return (
    tool !== undefined &&
    (isExecutableTool(tool) ||
      (externalExecutorAvailable && tool.type === "function"))
  );
}

/** Resolve authored function stubs as well as locally executable tool kinds. */
export function findTool(
  tools: readonly Tool[],
  name: string
): Tool | undefined {
  return tools.find(
    (tool) => tool.type !== "provider-hosted" && tool.name === name
  );
}

/**
 * The single home for "call a tool and record its result". Resolves the tool by
 * name, executes it, writes the output back to the store, and classifies
 * Firecrawl-limit errors. Error *reporting* (single toast vs. bulk aggregate)
 * stays at the call site — only detection and plumbing are shared here.
 */
export function useToolCallRunner(messageId: string) {
  const tools = useThreadStore((state) => state.thread.context?.tools);
  const thread = useThreadStore((state) => state.thread);
  const externalToolExecutionAvailable = useThreadStore(
    (state) => state.externalToolExecutionAvailable
  );
  const executeTool = useToolExecutor();
  const { updateToolCallOutput, updateToolCallOutputText } =
    useThreadStoreActions();
  const { runExternalToolCall } = useThreadStoreActions();

  const resolveTool = useCallback(
    (name: string): Tool | undefined => findTool(tools ?? [], name),
    [tools]
  );
  const canExecuteTool = useCallback(
    (name: string) =>
      canRunToolCall(resolveTool(name), externalToolExecutionAvailable),
    [externalToolExecutionAvailable, resolveTool]
  );

  const runToolCall = useCallback(
    async (toolCall: ToolCall): Promise<ToolCallOutcome | null> => {
      if (await runExternalToolCall(messageId, toolCall.id)) {
        return { isError: false, isFirecrawlLimit: false };
      }
      const tool = resolveTool(toolCall.input.name);
      if (!tool || !isExecutableTool(tool) || !executeTool) {
        return null;
      }
      try {
        const owningThread = structuredClone(thread);
        const { content, isError } = await executeTool(
          tool,
          toolCall.input.arguments,
          { thread: owningThread, variables: {} }
        );
        updateToolCallOutput(messageId, toolCall.id, content, isError);
        const text = getToolResultText(content);
        return {
          isError,
          isFirecrawlLimit: isError && isFirecrawlLimitError(text),
        };
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "Tool call failed";
        updateToolCallOutputText(messageId, toolCall.id, text, true);
        return { isError: true, isFirecrawlLimit: isFirecrawlLimitError(text) };
      }
    },
    [
      executeTool,
      messageId,
      resolveTool,
      thread,
      updateToolCallOutput,
      updateToolCallOutputText,
      runExternalToolCall,
    ]
  );

  return { canExecuteTool, resolveTool, runToolCall };
}
