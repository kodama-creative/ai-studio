import {
  DragDropContext,
  Draggable,
  Droppable,
  type DroppableProvided,
  type DropResult
} from "@hello-pangea/dnd";
import {
  type AssistantMessage,
  convertToPiContext,
  type Message,
  type ThreadContext,
  type ThreadRuntimeWorkingBase,
  type ThreadSandboxAttachments
} from "@llm-space/core";
import {
  latestRuntimeCompaction,
  runtimeHistoryMessagePath,
  type RuntimeToolApprovalView,
  runtimeToolApprovalViews,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import { PlusIcon } from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { cn } from "@/lib/utils";
import { MessageListItem } from "./message-list-item";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import { ShineBorder } from "../../ui/shine-border";
import { StructuredOutputCard } from "../output/structured-output-card";
import { SessionBudgetCard } from "../session-budget-card";
import {
  type RunValidationIssue,
  useThreadStore,
  useThreadStoreActions
} from "../stores";

export function MessageListView({
  className,
  context: contextFromProps,
  messages: messagesFromProps,
  readonly: readonlyFromProps = false,
  runDisabled = false,
  editingMode = "full"
}: {
  readonly className?: string;
  readonly context?: ThreadContext;
  readonly editingMode?: "appendTextOnly" | "full";
  readonly messages?: Message[];
  readonly readonly?: boolean;
  readonly runDisabled?: boolean;
}) {
  const isSnapshotView = messagesFromProps !== undefined;
  const status = useThreadStore(s => s.status);
  const collapsedMessageIds = useThreadStore(s => s.collapsedMessageIds);
  const autoFocusMessageId = useThreadStore(s => s.autoFocusMessageId);
  const runValidationIssue = useThreadStore(s => s.runValidationIssue);
  const storeMessages = useThreadStore(s => s.thread.context?.messages);
  const persistedRuntimeSession = useThreadStore(state => (
    isSnapshotView ? undefined : state.thread.runtimeSession
  ));
  const runtimeWorkingBase = useThreadStore(state => (
    isSnapshotView ? undefined : state.thread.runtimeWorkingBase
  ));
  const sandboxAttachments = useThreadStore(state => (
    isSnapshotView ? undefined : state.thread.sandboxAttachments
  ));
  const { appendMessage, moveMessage, resolveRunValidationIssue } =
    useThreadStoreActions();
  const [dragging, setDragging] = useState(false);
  const messages = useMemo(
    () => messagesFromProps ?? storeMessages ?? [],
    [messagesFromProps, storeMessages]
  );
  const toolApprovalsByMessageId = useMemo(() => {
    const result = new Map<string, RuntimeToolApprovalView[]>();
    const session = persistedRuntimeSession as StoredRuntimeSession | undefined;
    if (!session?.snapshot) { return result; }
    const messageIdByToolCallId = new Map<string, string>();
    for (const message of messages) {
      if (message.role !== "assistant") { continue; }
      for (const toolCall of message.toolCalls ?? []) {
        messageIdByToolCallId.set(toolCall.id, message.id);
      }
    }
    for (const approval of runtimeToolApprovalViews(session)) {
      const messageId = messageIdByToolCallId.get(approval.toolCallId);
      if (!messageId) { continue; }
      const approvals = result.get(messageId) ?? [];
      approvals.push(approval);
      result.set(messageId, approvals);
    }
    return result;
  }, [messages, persistedRuntimeSession]);
  const readonly = useMemo(() => {
    return readonlyFromProps || dragging || isSnapshotView;
  }, [dragging, isSnapshotView, readonlyFromProps]);
  const compactionBoundaryIndex = useMemo(
    () => _compactionBoundaryMessageIndex({
      context: contextFromProps,
      messages,
      runtimeSession: persistedRuntimeSession,
      runtimeWorkingBase,
      sandboxAttachments
    }),
    [
      contextFromProps,
      messages,
      persistedRuntimeSession,
      runtimeWorkingBase,
      sandboxAttachments
    ]
  );
  const addMessageSuggested =
    runValidationIssue?.resolution?.type === "appendUserMessage";

  const handleDragStart = useCallback(() => {
    setDragging(true);
  }, []);
  const handleDragEnd = useCallback((result: DropResult) => {
    setDragging(false);
    const { source, destination } = result;
    if (!destination || source.index === destination.index) { return; }
    moveMessage(source.index, destination.index);
  }, [moveMessage]);

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    const viewport = contentRef.current?.closest<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  // Jump to the latest messages when a run starts so the streaming reply is
  // in view. Fires on the idle → running transition (status only flips here).
  useEffect(() => {
    if (status === "running") {
      scrollToBottom();
    }
  }, [status, scrollToBottom]);

  return (
    <ScrollArea className={cn("size-full", className)} type="auto">
      <div className="flex flex-col p-3 pt-0.5" ref={contentRef}>
        {isSnapshotView
          ? (
            <StaticMessageList
              context={contextFromProps}
              messages={messages}
              readonly={readonly}
            />
          )
          : (
            <DragDropContext
              onDragEnd={handleDragEnd}
              onDragStart={handleDragStart}
            >
              <Droppable droppableId="message-list">
                {droppableProvided => (
                  <DroppableMessageList
                    autoFocusMessageId={autoFocusMessageId}
                    collapsedMessageIds={collapsedMessageIds}
                    compactionBoundaryIndex={compactionBoundaryIndex}
                    droppableProvided={droppableProvided}
                    editingMode={editingMode}
                    messages={messages}
                    readonly={readonly}
                    runDisabled={runDisabled}
                    runValidationIssue={runValidationIssue}
                    toolApprovalsByMessageId={toolApprovalsByMessageId}
                  />
                )}
              </Droppable>
            </DragDropContext>
          )}
        {!isSnapshotView && (
          <StreamingMessageListItem streaming={status === "running"} />
        )}
        {!isSnapshotView ? <LatestStructuredOutputFailure /> : null}
        {!isSnapshotView ? <SessionBudgetCard /> : null}
        <div className="relative rounded-lg">
          <Button
            // No top margin: the preceding message / streaming item (or, in the
            // empty state, the list's own top padding) already provides the gap.
            className={cn(
              "text-muted-foreground hover:text-accent-foreground w-full justify-start rounded-lg py-5",
              dragging && "invisible",
              (readonly
                || (editingMode === "appendTextOnly"
                  && messages.at(-1)?.role === "user"))
                && "hidden"
            )}
            disabled={readonly}
            onClick={
              addMessageSuggested ? resolveRunValidationIssue : appendMessage
            }
            size="lg"
            variant="secondary"
          >
            <PlusIcon className="size-4" />
            Add message
          </Button>
          {addMessageSuggested && !dragging && !readonly
            ? (
              <>
                <ShineBorder
                  borderWidth={1}
                  duration={14}
                  shineColor="var(--primary)"
                />
                <ShineBorder
                  borderWidth={1}
                  duration={14}
                  shineColor="var(--primary)"
                  style={{ animationDelay: "-7s" }}
                />
              </>
            )
            : null}
        </div>
      </div>
    </ScrollArea>
  );
}

function LatestStructuredOutputFailure() {
  const failure = useThreadStore(state => {
    if (state.status === "running") { return undefined; }
    const latestRun = state.runHistory.at(-1);
    const latestRunMessageId = latestRun?.thread.context?.messages?.at(-1)?.id;
    const latestThreadMessageId = state.thread.context?.messages?.at(-1)?.id;
    return latestRunMessageId
      && latestRunMessageId === latestThreadMessageId
      && latestRun?.thread.outputContract === state.thread.outputContract
      ? latestRun?.structuredOutputFailure
      : undefined;
  });
  return failure
    ? <StructuredOutputCard className="mb-3.5" failure={failure} />
    : null;
}

function StaticMessageList({
  sandboxAttachments,
  context,
  hideStructuredOutputs,
  messages,
  readonly
}: {
  readonly context?: ThreadContext;
  readonly hideStructuredOutputs?: boolean;
  readonly messages: Message[];
  readonly readonly: boolean;
  readonly sandboxAttachments?: ThreadSandboxAttachments;
}) {
  return (
    <div className="flex flex-col pt-3">
      {messages.map(message => (
        <MessageListItem
          className="mb-3.5"
          context={context}
          hideStructuredOutputs={hideStructuredOutputs}
          key={message.id}
          message={message}
          readonly={readonly}
          sandboxAttachments={sandboxAttachments?.[message.id]}
        />
      ))}
    </div>
  );
}

export const SnapshotMessageListView = memo(({
  className,
  context,
  hideStructuredOutputs,
  messages,
  sandboxAttachments
}: {
  readonly className?: string;
  readonly context?: ThreadContext;
  readonly hideStructuredOutputs?: boolean;
  readonly messages: Message[];
  readonly sandboxAttachments?: ThreadSandboxAttachments;
}) => {
  return (
    <ScrollArea className={cn("size-full", className)} type="auto">
      <div className="flex flex-col p-3 pt-0.5">
        <StaticMessageList
          context={context}
          hideStructuredOutputs={hideStructuredOutputs}
          messages={messages}
          readonly
          sandboxAttachments={sandboxAttachments}
        />
      </div>
    </ScrollArea>
  );
});

/* eslint-disable react-hooks/refs -- @hello-pangea/dnd exposes its callback ref through a render-prop object. */
function DroppableMessageList({
  droppableProvided,
  messages,
  editingMode,
  readonly,
  runDisabled,
  autoFocusMessageId,
  collapsedMessageIds,
  compactionBoundaryIndex,
  runValidationIssue,
  toolApprovalsByMessageId
}: {
  readonly autoFocusMessageId: string | null;
  readonly collapsedMessageIds: string[];
  readonly compactionBoundaryIndex: number | null;
  readonly droppableProvided: DroppableProvided;
  readonly editingMode: "appendTextOnly" | "full";
  readonly messages: Message[];
  readonly readonly: boolean;
  readonly runDisabled: boolean;
  readonly runValidationIssue: RunValidationIssue | null;
  readonly toolApprovalsByMessageId: ReadonlyMap<
    string,
    readonly RuntimeToolApprovalView[]
  >;
}) {
  return (
    <div
      className="flex flex-col pt-3"
      ref={droppableProvided.innerRef}
      {...droppableProvided.droppableProps}
    >
      {messages.map((message, index) => {
        const textOnlyDraft =
          editingMode === "appendTextOnly"
          && index === messages.length - 1
          && message.role === "user";
        return (
          <Fragment key={message.id}>
            {index === compactionBoundaryIndex
              ? <CompactionBoundaryMarker />
              : null}
            <DraggableMessageRow
              autoFocus={message.id === autoFocusMessageId}
              collapsed={collapsedMessageIds.includes(message.id)}
              index={index}
              message={message}
              readonly={
                readonly
                || (editingMode === "appendTextOnly" && !textOnlyDraft)
              }
              runDisabled={runDisabled}
              runValidationIssue={
                message.id === runValidationIssue?.messageId
                  ? runValidationIssue
                  : null
              }
              textOnlyDraft={textOnlyDraft}
              toolApprovals={toolApprovalsByMessageId.get(message.id)}
            />
          </Fragment>
        );
      })}
      {droppableProvided.placeholder}
    </div>
  );
}
/* eslint-enable react-hooks/refs */

function CompactionBoundaryMarker() {
  return (
    <div
      aria-label="Context compaction boundary"
      className="text-muted-foreground mb-3.5 flex items-center gap-2 px-1 text-[0.625rem]"
      role="note"
    >
      <span aria-hidden className="bg-border h-px flex-1" />
      <span>Context compacted · earlier messages retained</span>
      <span aria-hidden className="bg-border h-px flex-1" />
    </div>
  );
}

function _compactionBoundaryMessageIndex(input: {
  readonly context?: ThreadContext;
  readonly messages: readonly Message[];
  readonly runtimeSession: unknown;
  readonly runtimeWorkingBase?: ThreadRuntimeWorkingBase;
  readonly sandboxAttachments?: ThreadSandboxAttachments;
}): number | null {
  try {
    const session = input.runtimeSession as StoredRuntimeSession | undefined;
    const base = input.runtimeWorkingBase;
    if (
      session?.snapshot.schemaVersion !== 5
      || base?.sessionId !== session.snapshot.id
    ) {
      return null;
    }
    const history = session.snapshot.history;
    const checkpoint = history.checkpoints.find(item => (
      item.id === base.checkpointId && item.branchId === base.branchId
    ));
    if (!checkpoint) { return null; }
    const compaction = latestRuntimeCompaction(history, checkpoint.headEntryId);
    if (!compaction) { return null; }
    const firstKeptIndex = runtimeHistoryMessagePath(
      history,
      checkpoint.headEntryId
    ).findIndex(entry => entry.id === compaction.firstKeptEntryId);
    if (firstKeptIndex <= 0) { return null; }
    let runtimeMessageIndex = 0;
    for (let index = 0; index < input.messages.length; index += 1) {
      const message = input.messages[index];
      if (!message) { continue; }
      const convertedCount = convertToPiContext({
        ...input.context,
        messages: [message]
      }, input.sandboxAttachments).messages.length;
      if (runtimeMessageIndex + convertedCount > firstKeptIndex) {
        return index;
      }
      runtimeMessageIndex += convertedCount;
    }
    return null;
  } catch {
    return null;
  }
}

// One draggable row. The `memo` boundary sits *above* the `<Draggable>` (not
// inside its render prop) so that editing one message doesn't re-render every
// row: @hello-pangea/dnd hands the render prop a fresh `draggableProvided` (with
// a new `dragHandleProps` object) on every parent render, which would defeat a
// memo placed on MessageListItem alone. With only stable data props here, the
// rows whose message/flags are unchanged bail — their `Draggable` and
// MessageListItem never re-render. Drags still work: the dragging/displaced rows
// re-render via the dnd store subscription inside `Draggable`, not via props.
const _DraggableMessageRow = function DraggableMessageRow({
  message,
  index,
  readonly,
  runDisabled,
  autoFocus,
  collapsed,
  textOnlyDraft,
  runValidationIssue,
  toolApprovals
}: {
  readonly autoFocus: boolean;
  readonly collapsed: boolean;
  readonly index: number;
  readonly message: Message;
  readonly readonly: boolean;
  readonly runDisabled: boolean;
  readonly runValidationIssue: RunValidationIssue | null;
  readonly textOnlyDraft: boolean;
  readonly toolApprovals?: readonly RuntimeToolApprovalView[];
}) {
  return (
    <Draggable draggableId={message.id} index={index} isDragDisabled={readonly}>
      {draggableProvided => {
        const { style, ...draggableProps } = draggableProvided.draggableProps;
        return (
          <div
            ref={draggableProvided.innerRef}
            {...draggableProps}
            // Spacing lives on the draggable as a margin (not a flex `gap` on the
            // list) because @hello-pangea/dnd measures item margins to size the
            // placeholder and compute drag displacement — a `gap` is invisible to
            // it and offsets every item mid-drag.
            className="mb-3.5"
            style={style}
          >
            <MessageListItem
              autoFocus={autoFocus}
              collapsed={collapsed}
              dragHandleProps={draggableProvided.dragHandleProps}
              message={message}
              readonly={readonly}
              runDisabled={runDisabled}
              runValidationIssue={runValidationIssue}
              textOnlyDraft={textOnlyDraft}
              toolApprovals={toolApprovals}
            />
          </div>
        );
      }}
    </Draggable>
  );
};
const DraggableMessageRow = memo(_DraggableMessageRow);

function StreamingMessageListItem({ streaming }: { readonly streaming: boolean; }) {
  let streamingMessage: AssistantMessage | null = useThreadStore(
    s => s.streamingMessage
  );
  if (!streamingMessage && streaming) {
    streamingMessage = streamingMessage ?? {
      id: "streaming",
      role: "assistant",
      content: []
    };
  }
  if (!streamingMessage) {
    return null;
  }
  return (
    <MessageListItem
      className="mb-3.5"
      message={streamingMessage}
      readonly
      streaming
    />
  );
}
