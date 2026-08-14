import type {
  StudioThread,
  StudioThreadEventData,
  StudioRunHistoryEntry,
} from "@llm-space/studio";
import type { StudioEvaluationMetadata } from "@llm-space/studio/evaluation";
import { CodeEditor } from "@llm-space/ui/components/code-editor";
import {
  ThreadPlayground,
  type ThreadRunMetadata,
} from "@llm-space/ui/components/thread-playground";
import { Button } from "@llm-space/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@llm-space/ui/ui/empty";
import { ScrollArea } from "@llm-space/ui/ui/scroll-area";
import {
  BotIcon,
  FileCodeIcon,
  FileIcon,
  FolderIcon,
  FolderTreeIcon,
  MessageSquareIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createRpcProjectStudioClient } from "@/client/rpc-project-studio-client";
import { useCommands, useRegisterCommands } from "@/commands";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import type { AgentProjectView } from "@/shared/agent-project";
import type {
  ProjectSourceNode,
  ProjectStudioTransport,
} from "@/shared/project-studio";

import {
  createProjectThreadExecutionRuntime,
  playgroundThreadToStudioEvaluationMetadata,
  playgroundThreadToStudioDocument,
  shouldPersistProjectThread,
  studioThreadToPlaygroundThread,
} from "./project-thread-adapter";

type ProjectTab =
  | {
      readonly id: string;
      readonly type: "thread";
      readonly threadId: string;
      readonly title: string;
    }
  | {
      readonly id: string;
      readonly type: "code";
      readonly path: string;
      readonly title: string;
      readonly content: string;
    };

export function ProjectPage({ project }: { project: AgentProjectView }) {
  const client = useMemo(() => createRpcProjectStudioClient(), []);
  const { executeCommand } = useCommands();
  const [threads, setThreads] = useState<readonly StudioThread[]>([]);
  const [runHistory, setRunHistory] = useState<
    ReadonlyMap<string, readonly StudioRunHistoryEntry[]>
  >(new Map());
  const [evaluationMetadata, setEvaluationMetadata] = useState<
    ReadonlyMap<string, StudioEvaluationMetadata>
  >(new Map());
  const [sourceFiles, setSourceFiles] = useState<readonly ProjectSourceNode[]>(
    []
  );
  const [expandedSourceIds, setExpandedSourceIds] = useState<readonly string[]>(
    []
  );
  const [tabs, setTabs] = useState<readonly ProjectTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>();
  const [activeThread, setActiveThread] = useState<StudioThread>();
  const [loading, setLoading] = useState(true);
  const [openError, setOpenError] = useState<string>();
  const activeThreadId = useRef<string | undefined>(undefined);
  const lastSequences = useRef(new Map<string, number>());
  const subscription = useRef<AbortController | undefined>(undefined);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const visibleThread =
    activeTab?.type === "thread" && activeThread?.id === activeTab.threadId
      ? activeThread
      : undefined;
  const openingThread =
    activeTab?.type === "thread" && activeThread?.id !== activeTab.threadId;

  const openThreadTab = useCallback((thread: StudioThread) => {
    const id = `thread:${thread.id}`;
    setTabs((current) =>
      current.some((tab) => tab.id === id)
        ? current.map((tab) =>
            tab.id === id ? { ...tab, title: thread.document.title } : tab
          )
        : [
            ...current,
            {
              id,
              type: "thread" as const,
              threadId: thread.id,
              title: thread.document.title,
            },
          ]
    );
    setActiveTabId(id);
  }, []);

  const openCodeFile = useCallback(
    async (path: string) => {
      const id = `code:${path}`;
      const existing = tabs.find((tab) => tab.id === id);
      if (existing !== undefined) {
        setActiveTabId(id);
        return;
      }
      try {
        const content = await client.readSourceFile(path);
        setTabs((current) => [
          ...current,
          {
            id,
            type: "code",
            path,
            title: path.split("/").at(-1) ?? path,
            content,
          },
        ]);
        setActiveTabId(id);
      } catch (error) {
        toast.error("Unable to open source file", {
          description: _errorMessage(error),
        });
      }
    },
    [client, tabs]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === tabId);
        const next = current.filter((tab) => tab.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next[Math.min(index, next.length - 1)]?.id);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const refreshThreads = useCallback(async () => {
    const items = await client.listThreads();
    setThreads(items);
    setActiveThread((value) => {
      if (value === undefined) return value;
      return items.find((item) => item.id === value.id) ?? value;
    });
  }, [client]);

  const subscribeToThreadEvents = useCallback(
    (threadId: string) => {
      subscription.current?.abort();
      const controller = new AbortController();
      subscription.current = controller;
      void (async () => {
        try {
          for await (const item of client.events(threadId, {
            afterSequence: lastSequences.current.get(threadId),
            signal: controller.signal,
          })) {
            lastSequences.current.set(threadId, item.sequence);
            if (activeThreadId.current !== threadId) return;
            if (item.event.type === "conversation.updated") {
              setActiveThread(item.event.thread);
            }
            if (_isTerminalRunEvent(item.event)) {
              const next = await client.loadThread(threadId);
              if (next !== undefined && activeThreadId.current === threadId) {
                setActiveThread(next);
              }
              await refreshThreads();
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            toast.error("Studio Thread stream failed", {
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
        const [next, history, metadata] = await Promise.all([
          client.loadThread(threadId),
          client.listRunHistory(threadId),
          client.listEvaluationMetadata(threadId),
        ]);
        if (next === undefined)
          throw new Error(`Thread "${threadId}" was not found.`);
        setRunHistory((current) => new Map(current).set(threadId, history));
        setEvaluationMetadata((current) =>
          new Map(current).set(threadId, metadata)
        );
        setOpenError(undefined);
        activeThreadId.current = threadId;
        setActiveThread(next);
        openThreadTab(next);
        subscribeToThreadEvents(threadId);
      } catch (error) {
        subscription.current?.abort();
        activeThreadId.current = undefined;
        setActiveThread(undefined);
        setOpenError(_errorMessage(error));
        toast.error("Unable to open Thread", {
          description: _errorMessage(error),
        });
      }
    },
    [client, openThreadTab, subscribeToThreadEvents]
  );

  const createThread = useCallback(async () => {
    try {
      const next = await client.createThread();
      setOpenError(undefined);
      await refreshThreads();
      activeThreadId.current = next.id;
      setActiveThread(next);
      setRunHistory((current) => new Map(current).set(next.id, []));
      setEvaluationMetadata((current) =>
        new Map(current).set(next.id, { evaluations: [], rubrics: [] })
      );
      openThreadTab(next);
      subscribeToThreadEvents(next.id);
    } catch (error) {
      toast.error("Unable to create Thread", {
        description: _errorMessage(error),
      });
    }
  }, [client, openThreadTab, subscribeToThreadEvents, refreshThreads]);

  const forkThread = useCallback(
    async (threadId: string, entryId?: string) => {
      const fork = await client.forkThread(threadId, {
        ...(entryId === undefined ? {} : { entryId }),
      });
      await refreshThreads();
      await openThread(fork.id);
    },
    [client, openThread, refreshThreads]
  );

  useRegisterCommands({
    "project.createThread": createThread,
    "project.forkThread": ({ threadId, checkpointId }) =>
      forkThread(threadId, checkpointId),
  });

  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    if (tab?.type === "thread" && activeThread?.id !== tab.threadId) {
      void openThread(tab.threadId);
    }
  }, [activeTabId, activeThread?.id, openThread, tabs]);

  useEffect(() => {
    let cancelled = false;
    const sourceController = new AbortController();
    void (async () => {
      try {
        for await (const snapshot of client.watchSourceFiles({
          signal: sourceController.signal,
        })) {
          if (cancelled) return;
          setSourceFiles(snapshot.files);
          const codeTabs = tabsRef.current.filter(
            (tab): tab is Extract<ProjectTab, { readonly type: "code" }> =>
              tab.type === "code"
          );
          const refreshed = await Promise.all(
            codeTabs.map(async (tab) => {
              try {
                return {
                  id: tab.id,
                  content: await client.readSourceFile(tab.path),
                };
              } catch {
                return undefined;
              }
            })
          );
          const contentById = new Map(
            refreshed.flatMap((item) =>
              item === undefined ? [] : [[item.id, item.content] as const]
            )
          );
          if (contentById.size > 0) {
            setTabs((current) =>
              current.map((tab) => {
                const content = contentById.get(tab.id);
                return tab.type === "code" && content !== undefined
                  ? { ...tab, content }
                  : tab;
              })
            );
          }
        }
      } catch (error) {
        if (!sourceController.signal.aborted) {
          toast.error("Project source watch failed", {
            description: _errorMessage(error),
          });
        }
      }
    })();
    void Promise.all([client.listThreads(), client.listSourceFiles()])
      .then(async ([items, files]) => {
        if (cancelled) return;
        setThreads(items);
        setSourceFiles(files);
        if (items[0] !== undefined) await openThread(items[0].id);
      })
      .catch((error: unknown) => {
        toast.error("Unable to load Project Threads", {
          description: _errorMessage(error),
        });
      })
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
      sourceController.abort();
      subscription.current?.abort();
    };
  }, [client, openThread]);

  const sourceTree = useMemo<TreeDataItem[]>(
    () =>
      _sourceTreeItems(
        sourceFiles,
        (path) => void openCodeFile(path),
        (path) =>
          setExpandedSourceIds((current) => {
            const id = `source:${path}`;
            return current.includes(id)
              ? current.filter((item) => item !== id)
              : [...current, id];
          })
      ),
    [openCodeFile, sourceFiles]
  );

  return (
    <div className="bg-background relative flex size-full min-h-0 pt-9">
      <header className="border-border electrobun-webkit-app-region-drag absolute inset-x-0 top-0 flex h-9 items-center justify-center border-b px-28">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <BotIcon className="size-4 shrink-0" />
          <span className="truncate">{project.name}</span>
        </div>
      </header>
      <aside className="border-border bg-muted/20 flex w-72 shrink-0 flex-col border-r">
        <div className="flex min-h-0 flex-1 flex-col border-b">
          <div className="flex h-9 shrink-0 items-center gap-2 px-3">
            <FolderTreeIcon className="text-muted-foreground size-3.5" />
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Code
            </span>
          </div>
          <ScrollArea className="min-h-0 flex-1 pb-2">
            {sourceTree.length === 0 ? (
              <div className="text-muted-foreground px-4 py-3 text-xs">
                No source files
              </div>
            ) : (
              <TreeView
                className="min-h-0"
                data={sourceTree}
                expandedIds={[...expandedSourceIds]}
                defaultLeafIcon={FileIcon}
                defaultNodeIcon={FolderIcon}
              />
            )}
          </ScrollArea>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between px-3">
            <div className="flex items-center gap-2">
              <MessageSquareIcon className="text-muted-foreground size-3.5" />
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Threads
              </span>
            </div>
            <Button
              aria-label="New Thread"
              size="icon-sm"
              variant="ghost"
              onClick={() =>
                executeCommand({ type: "project.createThread", args: {} })
              }
            >
              <PlusIcon />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1 px-2">
            {threads.length === 0 ? (
              <div className="text-muted-foreground px-2 py-3 text-xs">
                No Studio Threads
              </div>
            ) : (
              threads.map((thread) => (
                <button
                  className={`hover:bg-accent mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    activeTab?.type === "thread" &&
                    activeTab.threadId === thread.id
                      ? "bg-accent"
                      : ""
                  }`}
                  key={thread.id}
                  type="button"
                  onClick={() => void openThread(thread.id)}
                >
                  <span className="block truncate">
                    {thread.document.title}
                  </span>
                </button>
              ))
            )}
          </ScrollArea>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {tabs.length > 0 && (
          <div className="border-border flex h-10 shrink-0 items-end overflow-x-auto border-b px-1">
            {tabs.map((tab) => (
              <button
                className={`group border-border flex h-9 max-w-56 min-w-0 items-center gap-2 border-r px-3 text-xs ${
                  tab.id === activeTabId
                    ? "bg-background text-foreground"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                }`}
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.type === "code" ? (
                  <FileCodeIcon className="size-3.5 shrink-0" />
                ) : (
                  <MessageSquareIcon className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{tab.title}</span>
                <span
                  aria-label={`Close ${tab.title}`}
                  className="ml-auto rounded-sm opacity-0 group-hover:opacity-100 hover:bg-white/10"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }
                  }}
                >
                  <XIcon className="size-3" />
                </span>
              </button>
            ))}
          </div>
        )}
        {activeTab?.type === "code" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="text-muted-foreground border-border h-9 shrink-0 border-b px-4 py-2 font-mono text-xs">
              {activeTab.path}
            </div>
            <CodeEditor
              className="min-h-0 flex-1 rounded-none border-0"
              hideBorder
              readonly
              value={activeTab.content}
            />
          </div>
        ) : visibleThread === undefined ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {loading || openingThread
                  ? openingThread
                    ? "Opening Thread…"
                    : "Opening Project…"
                  : openError === undefined
                    ? "No Studio Threads yet"
                    : "This Thread cannot be opened"}
              </EmptyTitle>
              <EmptyDescription>
                {openError ??
                  "Create an independent Studio Thread for this Agent."}
              </EmptyDescription>
            </EmptyHeader>
            {!loading && (
              <EmptyContent>
                <Button
                  onClick={() =>
                    executeCommand({ type: "project.createThread", args: {} })
                  }
                >
                  <PlusIcon /> New Thread
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <_ProjectThreadPlaygroundPane
            client={client}
            history={runHistory.get(visibleThread.id) ?? []}
            evaluationMetadata={
              evaluationMetadata.get(visibleThread.id) ?? {
                evaluations: [],
                rubrics: [],
              }
            }
            thread={visibleThread}
            onThread={setActiveThread}
            onSettled={refreshThreads}
          />
        )}
      </main>
    </div>
  );
}

function _ProjectThreadPlaygroundPane({
  client,
  history,
  evaluationMetadata,
  thread,
  onThread,
  onSettled,
}: {
  readonly client: ProjectStudioTransport;
  readonly history: readonly StudioRunHistoryEntry[];
  readonly evaluationMetadata: StudioEvaluationMetadata;
  readonly thread: StudioThread;
  readonly onThread: (thread: StudioThread) => void;
  readonly onSettled: () => void | Promise<void>;
}) {
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const saveChain = useRef(Promise.resolve());
  const metadataSaveChain = useRef(Promise.resolve());
  const publishThread = useCallback(
    (next: StudioThread) => {
      threadRef.current = next;
      onThread(next);
    },
    [onThread]
  );
  const persist = useCallback(
    (next: import("@llm-space/core").Thread): Promise<void> => {
      // Engine checkpoints already own execution projections. Queue a Draft
      // only when the editor changed fields Studio actually persists.
      if (!shouldPersistProjectThread(next, threadRef.current)) {
        return Promise.resolve();
      }
      saveChain.current = saveChain.current
        .catch(() => undefined)
        .then(async () => {
          const current = threadRef.current;
          const saved = await client.saveDocument(
            current.id,
            playgroundThreadToStudioDocument(next, current)
          );
          publishThread(saved);
        });
      return saveChain.current;
    },
    [client, publishThread]
  );
  const persistRunMetadata = useCallback(
    (metadata: ThreadRunMetadata): Promise<void> => {
      metadataSaveChain.current = metadataSaveChain.current
        .catch(() => undefined)
        .then(async () => {
          const current = threadRef.current;
          await Promise.all([
            client.saveRunHistory(
              current.id,
              metadata.runHistory.map((run) => run.id)
            ),
            client.saveEvaluationMetadata(
              current.id,
              playgroundThreadToStudioEvaluationMetadata(metadata)
            ),
          ]);
        });
      return metadataSaveChain.current;
    },
    [client]
  );
  const executionRuntime = useMemo(
    () =>
      createProjectThreadExecutionRuntime({
        client,
        threadId: thread.id,
        getThread: () => threadRef.current,
        onThread: publishThread,
        beforeExecute: () => saveChain.current,
        onSettled,
      }),
    [client, onSettled, publishThread, thread.id]
  );
  return (
    <ThreadPlayground
      active
      className="min-h-0 flex-1"
      definitionReadonly
      modelSelectionReadonly={false}
      executionRuntime={executionRuntime}
      initialValue={studioThreadToPlaygroundThread(
        thread,
        history,
        evaluationMetadata
      )}
      path={`threads/${thread.id}`}
      storeKey={thread.id}
      title={thread.document.title}
      onChange={(next) => {
        void persist(next).catch((error: unknown) => {
          toast.error("Unable to save Studio Thread", {
            description: _errorMessage(error),
          });
        });
      }}
      onRunMetadataChange={(metadata) => {
        void persistRunMetadata(metadata).catch((error: unknown) => {
          toast.error("Unable to save Run metadata", {
            description: _errorMessage(error),
          });
        });
      }}
      onRenameTitle={async (title) => {
        const current = threadRef.current;
        try {
          const saved = await client.saveDocument(current.id, {
            ...current.document,
            title,
          });
          publishThread(saved);
          return true;
        } catch (error) {
          toast.error("Unable to rename Studio Thread", {
            description: _errorMessage(error),
          });
          return false;
        }
      }}
    />
  );
}

function _sourceTreeItems(
  nodes: readonly ProjectSourceNode[],
  openFile: (path: string) => void,
  toggleDirectory: (path: string) => void
): TreeDataItem[] {
  return nodes.map((node) => ({
    id: `source:${node.path}`,
    name: node.name,
    icon: node.type === "file" ? FileIcon : FolderIcon,
    ...(node.type === "file"
      ? { onClick: () => openFile(node.path) }
      : {
          children: _sourceTreeItems(
            node.children ?? [],
            openFile,
            toggleDirectory
          ),
          onClick: () => toggleDirectory(node.path),
        }),
  }));
}

function _isTerminalRunEvent(event: StudioThreadEventData): boolean {
  return (
    event.type === "operation.completed" ||
    event.type === "operation.failed" ||
    event.type === "operation.aborted"
  );
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
