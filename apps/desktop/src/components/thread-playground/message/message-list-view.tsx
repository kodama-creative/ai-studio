import {
  DragDropContext,
  Draggable,
  Droppable,
  type DroppableProvided,
  type DropResult
} from "@hello-pangea/dnd";
import { PlusIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssistantMessage, Message, ThreadContext } from "@llm-space/core";

import { cn } from "@/lib/utils";
import { MessageListItem } from "./message-list-item";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import { useThreadStore, useThreadStoreActions } from "../stores";

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
  const storeMessages = useThreadStore(s => s.thread.context?.messages);
  const { appendMessage, moveMessage } = useThreadStoreActions();
  const [dragging, setDragging] = useState(false);
  const messages = messagesFromProps ?? storeMessages ?? [];
  const readonly = useMemo(() => {
    return readonlyFromProps || dragging || isSnapshotView;
  }, [dragging, isSnapshotView, readonlyFromProps]);

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
                    droppableProvided={droppableProvided}
                    editingMode={editingMode}
                    messages={messages}
                    readonly={readonly}
                    runDisabled={runDisabled}
                  />
                )}
              </Droppable>
            </DragDropContext>
          )}
        {!isSnapshotView && (
          <StreamingMessageListItem streaming={status === "running"} />
        )}
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
          onClick={appendMessage}
          size="lg"
          variant="secondary"
        >
          <PlusIcon className="size-4" />
          Add message
        </Button>
      </div>
    </ScrollArea>
  );
}

function StaticMessageList({
  context,
  messages,
  readonly
}: {
  readonly context?: ThreadContext;
  readonly messages: Message[];
  readonly readonly: boolean;
}) {
  return (
    <div className="flex flex-col pt-3">
      {messages.map(message => (
        <MessageListItem
          className="mb-3.5"
          context={context}
          key={message.id}
          message={message}
          readonly={readonly}
        />
      ))}
    </div>
  );
}

export const SnapshotMessageListView = memo(({
  className,
  context,
  messages
}: {
  readonly className?: string;
  readonly context?: ThreadContext;
  readonly messages: Message[];
}) => {
  return (
    <ScrollArea className={cn("size-full", className)} type="auto">
      <div className="flex flex-col p-3 pt-0.5">
        <StaticMessageList context={context} messages={messages} readonly />
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
  collapsedMessageIds
}: {
  readonly autoFocusMessageId: string | null;
  readonly collapsedMessageIds: string[];
  readonly droppableProvided: DroppableProvided;
  readonly editingMode: "appendTextOnly" | "full";
  readonly messages: Message[];
  readonly readonly: boolean;
  readonly runDisabled: boolean;
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
          <DraggableMessageRow
            autoFocus={message.id === autoFocusMessageId}
            collapsed={collapsedMessageIds.includes(message.id)}
            index={index}
            key={message.id}
            message={message}
            readonly={
              readonly
              || (editingMode === "appendTextOnly" && !textOnlyDraft)
            }
            runDisabled={runDisabled}
            textOnlyDraft={textOnlyDraft}
          />
        );
      })}
      {droppableProvided.placeholder}
    </div>
  );
}
/* eslint-enable react-hooks/refs */

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
  textOnlyDraft
}: {
  readonly autoFocus: boolean;
  readonly collapsed: boolean;
  readonly index: number;
  readonly message: Message;
  readonly readonly: boolean;
  readonly runDisabled: boolean;
  readonly textOnlyDraft: boolean;
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
              textOnlyDraft={textOnlyDraft}
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
