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
import { CircleAlertIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";
import type { RuntimeToolApprovalView } from "@llm-space/runtime/harness";

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
import {
  type RunValidationIssue,
  useThreadStore,
  useThreadStoreActions
} from "../stores";
import { usePromptVariableExtensionForContext } from "../variable/use-prompt-variable-extension";

const EMPTY_SANDBOX_ATTACHMENTS: readonly SandboxAttachmentDescriptor[] = [];
const EMPTY_TOOL_APPROVALS: readonly RuntimeToolApprovalView[] = [];

const _MessageListItem = function MessageListItem({
  className,
  context,
  message,
  placeholder,
  readonly = false,
  runDisabled = false,
  runValidationIssue = null,
  sandboxAttachments,
  toolApprovals = EMPTY_TOOL_APPROVALS,
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
  readonly runValidationIssue?: RunValidationIssue | null;
  readonly sandboxAttachments?: readonly SandboxAttachmentDescriptor[];
  readonly streaming?: boolean;
  readonly textOnlyDraft?: boolean;
  readonly toolApprovals?: readonly RuntimeToolApprovalView[];

  /** Focus this message's editor on mount. Set only for a freshly-added message. */
  readonly autoFocus?: boolean;
  readonly dragHandleProps?: DraggableProvidedDragHandleProps | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeProfileType = useThreadStore(
    state => state.thread.runtimeProfile?.type ?? "desktopDirect"
  );
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
  const messageToolApprovals = toolApprovals;
  const firstPendingApprovalId = messageToolApprovals.find(
    approval => approval.state === "pending"
  )?.id;
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
    state.thread.lockedSandboxAttachmentMessageIds?.includes(message.id)
    ?? false);
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
      if (
        message.role === "user"
        && e.key === "Enter"
        && (e.metaKey || e.ctrlKey)
      ) {
        void handleRun();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [handleRun, message.role]
  );
  const validationErrorId = `message-${message.id}-run-error`;
  useEffect(() => {
    if (!runValidationIssue) {
      return;
    }
    containerRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest"
    });
  }, [runValidationIssue]);
  return (
    <div
      aria-describedby={runValidationIssue ? validationErrorId : undefined}
      aria-invalid={Boolean(runValidationIssue) || undefined}
      className={cn(
        "hover:border-accent-foreground/20 focus-within:border-ring! group group/message relative flex size-full flex-col items-center rounded-lg border bg-(--textarea) transition-[padding-bottom,border-color,box-shadow]",
        runValidationIssue?.level === "warning"
        && "border-amber-400/30! hover:border-amber-400/40! focus-within:border-amber-400/40!",
        runValidationIssue?.level === "error"
        && "border-destructive/40! hover:border-destructive/50! focus-within:border-destructive/50!",
        collapsed && !runValidationIssue && "pb-2.5",
        className
      )}
      ref={containerRef}
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
                    approval={messageToolApprovals.findLast(
                      approval => approval.toolCallId === toolCall.id
                    )}
                    canContinue={
                      !runDisabled && (toolCallSummary?.canContinue ?? false)
                    }
                    context={context}
                    focusApproval={messageToolApprovals.findLast(
                      approval => approval.toolCallId === toolCall.id
                    )?.id === firstPendingApprovalId}
                    key={toolCall.id}
                    messageId={message.id}
                    onContinue={handleContinue}
                    readonly={readonly}
                    runtimeProfileType={runtimeProfileType}
                    toolCall={toolCall}
                  />
                ))}
                {ordinaryToolCalls.length > 0
                  ? (
                    <ToolStepContinuation
                      messageId={message.id}
                      readonly={readonly}
                      runDisabled={runDisabled}
                      toolApprovals={messageToolApprovals}
                      toolCalls={ordinaryToolCalls}
                    />
                  )
                  : null}
              </div>
            )
            : null}
        </main>
      </CollapsibleContent>
      {runValidationIssue
        ? (
          <div
            className={cn(
              "text-foreground/75 mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2.5 py-1.5 text-xs motion-safe:transition-[margin-top] motion-safe:duration-200 motion-safe:ease-in-out",
              collapsed && "mt-2",
              runValidationIssue.level === "warning"
                ? "bg-amber-400/8"
                : "bg-destructive/8"
            )}
            id={validationErrorId}
            role="alert"
          >
            {runValidationIssue.level === "warning"
              ? <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-400/80" />
              : <CircleAlertIcon className="text-destructive/70 size-3.5 shrink-0" />}
            <span className="min-w-0 grow">{runValidationIssue.message}</span>
          </div>
        )
        : null}
    </div>
  );
};

const _ToolStepContinuation = function ToolStepContinuation({
  messageId,
  toolCalls,
  toolApprovals,
  readonly,
  runDisabled
}: {
  readonly messageId: string;
  readonly readonly?: boolean;
  readonly runDisabled?: boolean;
  readonly toolApprovals: readonly RuntimeToolApprovalView[];
  readonly toolCalls: ToolCall[];
}) {
  const status = useThreadStore(state => state.status);
  const runtimeSessionId = useThreadStore(state => (
    state.thread.runtimeSession as { snapshot?: { id?: string; }; } | undefined
  )?.snapshot?.id);
  const { run } = useThreadStoreActions();
  const approvalBatchRef = useRef<HTMLDivElement>(null);
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
    && callableToolCalls.length > 0
    && toolApprovals.length === 0;
  // "Continue" runs the thread from this message (continuing past the tool
  // results), mirroring the header's run action — enabled only once every tool
  // call has a response.
  const canContinue =
    !readonly
    && !runDisabled
    && status !== "running"
    && !callingTools
    && summarizeToolCalls(toolCalls).canContinue
    && toolApprovals.length === 0;
  const pendingApprovalCount = toolApprovals.filter(
    approval => approval.state === "pending"
  ).length;
  const approvedApprovalCount = toolApprovals.filter(
    approval => approval.state === "approved"
  ).length;
  const deniedApprovalCount = toolApprovals.filter(
    approval => approval.state === "denied"
  ).length;
  const approvalBatchReady = toolApprovals.length > 0
    && pendingApprovalCount === 0
    && toolApprovals.every(approval =>
      approval.state === "approved" || approval.state === "denied");
  const readyApprovalLabel = approvedApprovalCount === toolApprovals.length
    ? "Approved · ready to resume"
    : deniedApprovalCount === toolApprovals.length
      ? "Denied · ready to resume"
      : "Decisions recorded · ready to resume";
  const resumeApprovalLabel = approvedApprovalCount === toolApprovals.length
    ? "Resume approved run"
    : "Resume decided run";
  useEffect(() => {
    if (approvalBatchReady && status === "running") {
      approvalBatchRef.current?.scrollIntoView({ block: "nearest" });
      approvalBatchRef.current?.focus({ preventScroll: true });
    }
  }, [approvalBatchReady, status]);
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
          description: `${errorCount}/${outcomes.length} tool call${outcomes.length === 1 ? "" : "s"
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
  const handleResumeApproved = useCallback(async () => {
    if (
      readonly
      || runDisabled
      || status === "running"
      || !approvalBatchReady
    ) {
      return;
    }
    await run(messageId);
  }, [approvalBatchReady, messageId, readonly, run, runDisabled, status]);

  return (
    <div
      className={cn(
        "bg-foreground/4 flex min-w-0 items-center justify-between gap-3 rounded-md px-3 py-1",
        approvalBatchReady && "flex-col items-stretch gap-2 py-2"
      )}
      data-runtime-session-id={runtimeSessionId}
      data-tool-approval-batch={approvalBatchReady ? "ready" : undefined}
      ref={approvalBatchRef}
      tabIndex={-1}
    >
      <Marker className="min-w-0 grow" role="status">
        <MarkerContent
          className={cn("text-xs", !approvalBatchReady && "truncate")}
        >
          {pendingApprovalCount > 0
            ? `Waiting for approval · ${pendingApprovalCount} pending`
            : approvalBatchReady
              ? readyApprovalLabel
              : `${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`}
        </MarkerContent>
      </Marker>
      <div
        className={cn(
          "flex shrink-0 items-center gap-2",
          approvalBatchReady && "justify-end"
        )}
      >
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
        {approvalBatchReady
          ? (
            <Button
              disabled={readonly || runDisabled || status === "running"}
              onClick={() => void handleResumeApproved()}
              size="sm"
              variant="outline"
            >
              {resumeApprovalLabel}
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
