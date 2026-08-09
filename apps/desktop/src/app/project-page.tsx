import type { HarnessEventData, HarnessMessage } from "@llm-space/harness";
import { Button } from "@llm-space/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@llm-space/ui/ui/empty";
import { ScrollArea } from "@llm-space/ui/ui/scroll-area";
import { Textarea } from "@llm-space/ui/ui/textarea";
import { BotIcon, FolderIcon, PlusIcon, SquareIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { createRpcHarnessSessionClient } from "@/client/rpc-harness-session-client";
import type {
  AgentProjectView,
  ProjectThread,
  ProjectThreadSession,
} from "@/shared/agent-project";

export function ProjectPage({ project }: { project: AgentProjectView }) {
  const client = useMemo(() => createRpcHarnessSessionClient(), []);
  const [threads, setThreads] = useState<readonly ProjectThread[]>([]);
  const [activeThreadSession, setActiveThreadSession] = useState<ProjectThreadSession>();
  const [streamingText, setStreamingText] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [openError, setOpenError] = useState<string>();
  const activeSessionId = useRef<string | undefined>(undefined);
  const subscription = useRef<AbortController | undefined>(undefined);

  const refreshThreads = useCallback(async () => {
    const items = await client.listThreads();
    setThreads(items);
    setActiveThreadSession((value) => {
      if (value === undefined) return value;
      const thread = items.find((item) => item.id === value.thread.id);
      return thread === undefined ? value : { ...value, thread };
    });
  }, [client]);

  const subscribeToSessionEvents = useCallback(
    (sessionId: string, afterSequence: number) => {
      subscription.current?.abort();
      const controller = new AbortController();
      subscription.current = controller;
      void (async () => {
        try {
          for await (const item of client.events(sessionId, {
            afterSequence,
            signal: controller.signal,
          })) {
            if (activeSessionId.current !== sessionId) return;
            if (item.event.type === "message.appended") {
              const { delta } = item.event;
              setStreamingText((value) => value + delta);
            }
            if (_requiresSnapshotRefresh(item.event.type)) {
              const snapshot = await client.snapshot(sessionId);
              if (activeSessionId.current === sessionId) {
                setActiveThreadSession((value) =>
                  value === undefined ? value : { ...value, snapshot }
                );
              }
            }
            if (_isTerminalSessionEvent(item.event.type)) {
              setStreamingText("");
              await refreshThreads();
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            toast.error("Agent session stream failed", {
              description: _errorMessage(error),
            });
          }
        }
      })();
    },
    [client, refreshThreads]
  );

  const openThread = useCallback(
    async (threadId: string) => {
      try {
        const next = await client.attachThread(threadId);
        setOpenError(undefined);
        activeSessionId.current = next.thread.sessionId;
        setStreamingText("");
        setActiveThreadSession(next);
        subscribeToSessionEvents(
          next.thread.sessionId,
          next.snapshot.eventSequence
        );
      } catch (error) {
        subscription.current?.abort();
        activeSessionId.current = undefined;
        setActiveThreadSession(undefined);
        setOpenError(_generationAwareError(error));
        toast.error("Unable to open thread", {
          description: _errorMessage(error),
        });
      }
    },
    [client, subscribeToSessionEvents]
  );

  const createThread = useCallback(async () => {
    try {
      const next = await client.createThread();
      setOpenError(undefined);
      await refreshThreads();
      activeSessionId.current = next.thread.sessionId;
      setActiveThreadSession(next);
      setStreamingText("");
      subscribeToSessionEvents(
        next.thread.sessionId,
        next.snapshot.eventSequence
      );
    } catch (error) {
      toast.error("Unable to create thread", {
        description: _errorMessage(error),
      });
    }
  }, [client, subscribeToSessionEvents, refreshThreads]);

  useEffect(() => {
    let cancelled = false;
    void client
      .listThreads()
      .then(async (items) => {
        if (cancelled) return;
        setThreads(items);
        if (items[0] !== undefined) await openThread(items[0].id);
      })
      .catch((error: unknown) => {
        toast.error("Unable to load project threads", {
          description: _errorMessage(error),
        });
      })
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
      subscription.current?.abort();
    };
  }, [client, openThread]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (message.length === 0 || activeThreadSession === undefined) return;
    const sessionId = activeThreadSession.thread.sessionId;
    const previousSnapshot = activeThreadSession.snapshot;
    setInput("");
    setActiveThreadSession((value) =>
      value === undefined
        ? value
        : { ...value, snapshot: { ...value.snapshot, status: "running" } }
    );
    try {
      await client.send(sessionId, message);
    } catch (error) {
      setInput(message);
      setActiveThreadSession((value) =>
        value?.thread.sessionId === sessionId
          ? { ...value, snapshot: previousSnapshot }
          : value
      );
      toast.error("Unable to send message", {
        description: _errorMessage(error),
      });
    }
  };

  const cancel = async () => {
    if (activeThreadSession === undefined) return;
    try {
      await client.cancel(activeThreadSession.thread.sessionId);
    } catch (error) {
      toast.error("Unable to cancel run", {
        description: _errorMessage(error),
      });
    }
  };

  return (
    <div className="bg-background flex size-full min-h-0 pt-9">
      <aside className="border-border bg-muted/20 flex w-72 shrink-0 flex-col border-r">
        <div className="border-border border-b px-4 py-4">
          <div className="flex items-center gap-2 font-medium">
            <BotIcon className="size-4" />
            <span className="truncate">{project.name}</span>
          </div>
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <FolderIcon className="size-3" />
            <span className="truncate" title={project.rootPath}>
              {project.rootPath}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Threads
          </span>
          <Button
            aria-label="New Thread"
            size="icon-sm"
            variant="ghost"
            onClick={() => void createThread()}
          >
            <PlusIcon />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-2">
          {threads.map((thread) => (
            <button
              className={`hover:bg-accent mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                activeThreadSession?.thread.id === thread.id ? "bg-accent" : ""
              }`}
              key={thread.id}
              type="button"
              onClick={() => void openThread(thread.id)}
            >
              <span className="block truncate">{thread.title}</span>
            </button>
          ))}
        </ScrollArea>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {activeThreadSession === undefined ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {loading
                  ? "Opening project…"
                  : openError === undefined
                    ? "No agent threads yet"
                    : "This thread cannot use the current agent"}
              </EmptyTitle>
              <EmptyDescription>
                {openError ??
                  "Start a Harness session backed by this project’s local storage."}
              </EmptyDescription>
            </EmptyHeader>
            {!loading && (
              <EmptyContent>
                <Button onClick={() => void createThread()}>
                  <PlusIcon /> New Thread
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <>
            <div className="border-border flex h-12 shrink-0 items-center justify-between border-b px-5">
              <div className="truncate text-sm font-medium">
                {activeThreadSession.thread.title}
              </div>
              <div className="text-muted-foreground text-xs">
                {activeThreadSession.snapshot.status}
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
                {activeThreadSession.snapshot.error !== undefined && (
                  <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
                    {activeThreadSession.snapshot.error}
                  </div>
                )}
                {activeThreadSession.snapshot.messages.map((message) => (
                  <ProjectMessage key={message.id} message={message} />
                ))}
                {streamingText.length > 0 && (
                  <div className="bg-muted max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm">
                    {streamingText}
                  </div>
                )}
              </div>
            </ScrollArea>
            <form className="border-border shrink-0 border-t p-4" onSubmit={send}>
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <Textarea
                  className="max-h-40 min-h-11 resize-none"
                  disabled={
                    activeThreadSession.snapshot.status === "completed" ||
                    activeThreadSession.snapshot.status === "failed"
                  }
                  placeholder="Message this agent…"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                {activeThreadSession.snapshot.status === "running" ? (
                  <Button size="icon" type="button" onClick={() => void cancel()}>
                    <SquareIcon />
                  </Button>
                ) : (
                  <Button disabled={input.trim().length === 0} type="submit">
                    Send
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function ProjectMessage({ message }: { message: HarnessMessage }) {
  if (message.role === "tool") {
    return (
      <div className="border-border text-muted-foreground rounded-lg border px-3 py-2 font-mono text-xs">
        <div className="mb-1 font-medium">{message.name}</div>
        <pre className="whitespace-pre-wrap">{JSON.stringify(message.output, null, 2)}</pre>
      </div>
    );
  }
  const user = message.role === "user";
  return (
    <div
      className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${
        user ? "bg-primary text-primary-foreground ml-auto" : "bg-muted"
      }`}
    >
      {message.content}
    </div>
  );
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function _generationAwareError(error: unknown): string {
  const message = _errorMessage(error);
  return message.includes(" belongs to ")
    ? "The agent changed after this thread was created. Start a new thread to use the current agent generation."
    : message;
}

function _requiresSnapshotRefresh(type: HarnessEventData["type"]): boolean {
  return (
    type === "turn.started" ||
    type === "message.received" ||
    type === "message.completed" ||
    type === "action.result" ||
    _isTerminalSessionEvent(type)
  );
}

function _isTerminalSessionEvent(type: HarnessEventData["type"]): boolean {
  return (
    type === "session.waiting" ||
    type === "session.completed" ||
    type === "session.failed"
  );
}
