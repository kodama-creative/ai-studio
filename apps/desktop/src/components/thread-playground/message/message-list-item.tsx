import {
  getMessageText,
  type ImageDataContent,
  isExecutableTool,
  type Message,
  type SandboxAttachmentDescriptor,
  type ThreadContext,
  type ToolCall
} from "@llm-space/core";
import { createMessagePromptVariablePlaceKey } from "@llm-space/core/thread";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "@llm-space/runtime";
import { PlusIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";

import { structuredOutputFromToolCall } from "@/client/structured-output-from-tool-call";
import { openFirecrawlLimitDialog } from "@/components/firecrawl-limit-dialog";
import { useRenderingFidelity } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { ImageContentList } from "./image-content-view";
import { MessageListItemHeader } from "./message-list-item-header";
import { SandboxAttachmentList } from "./sandbox-attachment-list";
import { ThinkingView } from "./thinking-view";
import { ToolCallListItem } from "./tool-call-list-item";
import { isToolCallPending, summarizeToolCalls } from "./tool-call-status";
import { useToolCallRunner } from "./use-tool-call-runner";
import { CodeEditor } from "../../code-editor";
import { Tooltip } from "../../tooltip";
import { Button } from "../../ui/button";
import { CollapsibleContent } from "../../ui/collapsible-content";
import { Marker, MarkerContent } from "../../ui/marker";
import { ShineBorder } from "../../ui/shine-border";
import { Skeleton } from "../../ui/skeleton";
import { StructuredOutputCard } from "../output/structured-output-card";
import { useThreadStore, useThreadStoreActions } from "../stores";
import { usePromptVariableExtensionForContext } from "../variable/use-prompt-variable-extension";

const EMPTY_SANDBOX_ATTACHMENTS: readonly SandboxAttachmentDescriptor[] = [];

const _MessageListItem = function MessageListItem({
  className,
  context,
  message,
  placeholder,
  readonly = false,
  runDisabled = false,
  sandboxAttachments,
  streaming,
  collapsed,
  hideStructuredOutputs = false,
  autoFocus = false,
  textOnlyDraft = false,
  dragHandleProps
}: {
  readonly className?: string;
  readonly collapsed?: boolean;
  readonly context?: ThreadContext;
  readonly hideStructuredOutputs?: boolean;
  readonly message: Message;
  readonly placeholder?: string;
  readonly readonly?: boolean;
  readonly runDisabled?: boolean;
  readonly sandboxAttachments?: readonly SandboxAttachmentDescriptor[];
  readonly streaming?: boolean;
  readonly textOnlyDraft?: boolean;

  /** Focus this message's editor on mount. Set only for a freshly-added message. */
  readonly autoFocus?: boolean;
  readonly dragHandleProps?: DraggableProvidedDragHandleProps | null;
}) {
  const { fidelity } = useRenderingFidelity();
  const variableExtension = usePromptVariableExtensionForContext(
    createMessagePromptVariablePlaceKey(message.id),
    context
  );
  const text = useMemo(() => getMessageText(message), [message]);
  const imageContents = useMemo(() => {
    const result: Array<{ content: ImageDataContent; contentIndex: number; }> = [];
    message.content.forEach((content, contentIndex) => {
      if (content.type === "image_data") {
        result.push({ content, contentIndex });
      }
    });
    return result;
  }, [message.content]);
  const toolCallSummary = useMemo(
    () =>
      (message.role === "assistant" && message.toolCalls?.length
        ? summarizeToolCalls(message.toolCalls)
        : null),
    [message]
  );
  const ordinaryToolCalls = useMemo(
    () => (message.role === "assistant"
      ? (message.toolCalls ?? []).filter(
        toolCall => toolCall.input.name !== STRUCTURED_OUTPUT_TOOL_NAME
      )
      : []),
    [message]
  );
  const structuredOutputs = useMemo(
    () => (message.role === "assistant" && !hideStructuredOutputs
      ? (message.toolCalls ?? []).flatMap(toolCall => {
        const result = structuredOutputFromToolCall(toolCall);
        return result ? [result] : [];
      })
      : []),
    [hideStructuredOutputs, message]
  );
  const toolCallsOnlyBody = useMemo(
    () =>
      message.role === "assistant"
      && !message.thinking
      && message.content.length === 0
      && (message.toolCalls?.length ?? 0) > 0,
    [message]
  );
  const liveSandboxAttachments = useThreadStore(
    state => state.thread.sandboxAttachments?.[message.id]
  );
  const sandboxAttachmentsLocked = useThreadStore(state =>
    state.runHistory.some(run =>
      run.thread.context?.messages?.some(item => item.id === message.id)));
  const attachments = sandboxAttachments
    ?? liveSandboxAttachments
    ?? EMPTY_SANDBOX_ATTACHMENTS;
  const {
    addMessageImageContent,
    insertMessageBefore,
    run,
    updateMessageTextContent
  } = useThreadStoreActions();
  const handleRun = useCallback(async () => {
    if (readonly || runDisabled) {
      return;
    }
    await run(message.id);
  }, [message.id, readonly, run, runDisabled]);
  const handleContinue = useCallback(() => {
    void handleRun();
  }, [handleRun]);
  const handleTextContentChange = useCallback(
    (value: string) => {
      updateMessageTextContent(message.id, value);
    },
    [updateMessageTextContent, message.id]
  );
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (textOnlyDraft) {
        return;
      }
      if (message.role !== "user") {
        return;
      }
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) {
        return;
      }
      for (const item of clipboardItems) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (!file) {
            continue;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
            const [, mimeType, data] = match ?? [];
            if (mimeType && data) {
              addMessageImageContent(message.id, mimeType, data);
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    },
    [addMessageImageContent, message.id, message.role, textOnlyDraft]
  );
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.metaKey) {
        void handleRun();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [handleRun]
  );
  return (
    <div
      className={cn(
        "hover:border-accent-foreground/20 focus-within:border-ring! group group/message relative flex size-full flex-col items-center rounded-lg border bg-(--textarea) transition-[padding-bottom,border-color]",
        collapsed && "pb-2.5",
        className
      )}
    >
      <div
        className={cn(
          "transition-border group absolute -top-3.5 flex h-3 w-full shrink-0",
          "has-[button:hover]:[&>.insert-line]:border-primary has-[button:hover]:[&>.insert-line]:right-0",
          (readonly || textOnlyDraft) && "invisible"
        )}
      >
        <div className="insert-line absolute top-1.5 right-2 left-0 border-b border-dashed opacity-0 transition-[opacity,border-color,border-style] group-hover:opacity-100" />
        <Tooltip content="Insert Message Here">
          <Button
            aria-label="Insert message before this message"
            className="text-muted-foreground hover:border-primary hover:bg-primary! hover:text-primary-foreground absolute -top-0.5 -right-3 z-10 size-4 rounded-full opacity-0 transition-[opacity,background-color,color,border-color] group-hover:opacity-100"
            onClick={() => { insertMessageBefore(message.id); }}
            size="icon-xs"
            variant="outline"
          >
            <PlusIcon className="size-3" />
          </Button>
        </Tooltip>
      </div>
      {streaming && fidelity !== "lite"
        ? (
          <ShineBorder
            borderWidth={3}
            duration={8}
            shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
          />
        )
        : null}
      <MessageListItemHeader
        className={toolCallsOnlyBody ? "pb-2" : undefined}
        collapsed={collapsed}
        dragHandleProps={dragHandleProps}
        message={message}
        readonly={readonly}
        runDisabled={runDisabled}
        textOnlyDraft={textOnlyDraft}
      />
      <CollapsibleContent collapsed={collapsed}>
        <main className="flex w-full flex-col">
          {message.role === "assistant"
            && streaming
            && !message.thinking
            && message.content.length === 0
            && (!message.toolCalls || message.toolCalls.length === 0)
            ? <StreamingMessageSkeleton className="mt-2" />
            : null}
          {message.role === "assistant" && message.thinking ? <ThinkingView className="mt-2" thinking={message.thinking} /> : null}
          <ImageContentList
            images={imageContents}
            messageId={message.id}
            readonly={readonly || textOnlyDraft}
          />
          {message.role === "user"
            ? (
              <SandboxAttachmentList
                attachments={attachments}
                messageId={message.id}
                readonly={readonly || streaming || sandboxAttachmentsLocked}
              />
            )
            : null}
          {message.content.length > 0 && (
            <CodeEditor
              autoFocus={autoFocus}
              className="max-h-[40vh] min-h-9.5 w-full bg-transparent"
              extraExtensions={variableExtension}
              hideBorder
              hideFocusRing
              onChange={handleTextContentChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                placeholder
                ?? `Enter ${message.role === "user" ? "user" : "assistant"} message here`
              }
              plain={fidelity === "lite"}
              readonly={readonly}
              scrollOnFocus
              streaming={streaming}
              value={text}
            />
          )}
          {message.role === "assistant"
            && ((ordinaryToolCalls.length > 0) || structuredOutputs.length > 0)
            ? (
              <div className="flex w-full flex-col gap-3 px-2 pb-2">
                {structuredOutputs.map(result => (
                  <StructuredOutputCard
                    key={`${result.contract}:${result.schemaFingerprint}`}
                    result={result}
                  />
                ))}
                {ordinaryToolCalls.map(toolCall => (
                  <ToolCallListItem
                    canContinue={
                      !runDisabled && (toolCallSummary?.canContinue ?? false)
                    }
                    context={context}
                    key={toolCall.id}
                    messageId={message.id}
                    onContinue={handleContinue}
                    readonly={readonly}
                    toolCall={toolCall}
                  />
                ))}
                {ordinaryToolCalls.length > 0
                  ? (
                    <ToolStepContinuation
                      messageId={message.id}
                      readonly={readonly}
                      runDisabled={runDisabled}
                      toolCalls={ordinaryToolCalls}
                    />
                  )
                  : null}
              </div>
            )
            : null}
        </main>
      </CollapsibleContent>
    </div>
  );
};

const _ToolStepContinuation = function ToolStepContinuation({
  messageId,
  toolCalls,
  readonly,
  runDisabled
}: {
  readonly messageId: string;
  readonly readonly?: boolean;
  readonly runDisabled?: boolean;
  readonly toolCalls: ToolCall[];
}) {
  const status = useThreadStore(state => state.status);
  const { run } = useThreadStoreActions();
  const { resolveTool, runToolCall } = useToolCallRunner(messageId);
  const callableToolCalls = useMemo(
    () =>
      toolCalls.filter(toolCall => {
        if (!isToolCallPending(toolCall)) { return false; }
        const tool = resolveTool(toolCall.input.name);
        return tool !== undefined && isExecutableTool(tool);
      }),
    [toolCalls, resolveTool]
  );
  const [callingTools, setCallingTools] = useState(false);
  const canCallTools =
    !readonly
    && status !== "running"
    && !callingTools
    && callableToolCalls.length > 0;
  // "Continue" runs the thread from this message (continuing past the tool
  // results), mirroring the header's run action — enabled only once every tool
  // call has a response.
  const canContinue =
    !readonly
    && !runDisabled
    && status !== "running"
    && !callingTools
    && summarizeToolCalls(toolCalls).canContinue;
  const handleContinue = useCallback(async () => {
    if (!canContinue) {
      return;
    }
    await run(messageId);
  }, [canContinue, run, messageId]);
  const handleCallTools = useCallback(async () => {
    if (!canCallTools) {
      return;
    }
    setCallingTools(true);
    try {
      const outcomes = await Promise.all(
        callableToolCalls.map(async toolCall => runToolCall(toolCall))
      );
      let errorCount = 0;
      let firecrawlLimitCount = 0;
      for (const outcome of outcomes) {
        if (outcome?.isError) {
          errorCount += 1;
          if (outcome.isFirecrawlLimit) {
            firecrawlLimitCount += 1;
          }
        }
      }
      if (firecrawlLimitCount > 0) {
        openFirecrawlLimitDialog();
      }
      // Suppress the generic toast when the only failures are the Firecrawl
      // limit, since the dialog already explains them.
      if (errorCount > firecrawlLimitCount) {
        toast.error("Some tool calls failed", {
          description: `${errorCount}/${outcomes.length} tool call${
            outcomes.length === 1 ? "" : "s"
          } failed.`
        });
      }
    } finally {
      setCallingTools(false);
    }
  }, [
    callableToolCalls,
    canCallTools,
    runToolCall
  ]);

  return (
    <div className="bg-foreground/4 flex min-w-0 items-center justify-between gap-3 rounded-md px-3 py-1">
      <Marker className="min-w-0" role="status">
        <MarkerContent className="truncate text-xs">
          {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
        </MarkerContent>
      </Marker>
      <div className="flex shrink-0 items-center gap-2">
        {callableToolCalls.length > 0
          ? (
            <Button
              aria-label="Call available MCP and built-in tools"
              className="invisible shrink-0 group-hover/message:visible"
              disabled={!canCallTools}
              onClick={() => void handleCallTools()}
              size="sm"
              variant="outline"
            >
              Call tools
            </Button>
          )
          : null}
        <Tooltip content="Run from this message">
          <Button
            aria-label="Run from this message"
            className="invisible shrink-0 group-hover/message:visible"
            disabled={!canContinue}
            onClick={() => void handleContinue()}
            size="sm"
            variant="default"
          >
            Continue
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};
const ToolStepContinuation = memo(_ToolStepContinuation);

function StreamingMessageSkeleton({ className }: { readonly className?: string; }) {
  return (
    <div className={cn("px-1 pb-3", className)}>
      <div className="px-1.5">
        <Skeleton className="h-3 w-[33%] rounded" />
      </div>
      <div className="px-1 pt-3">
        <Skeleton className="animate-skeleton-extending h-4 w-[90%] rounded delay-750" />
      </div>
    </div>
  );
}

export const MessageListItem = memo(_MessageListItem);
