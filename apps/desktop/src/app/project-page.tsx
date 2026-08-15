import type { StudioThread } from "@llm-space/studio";
import { CodeEditor } from "@llm-space/ui/components/code-editor";
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import { createRpcProjectStudioClient } from "@/client/rpc-project-studio-client";
import { useCommands, useRegisterCommands } from "@/commands";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import type { AgentProjectView } from "@/shared/agent-project";
import type { ProjectSourceNode } from "@/shared/project-studio";

import { ProjectThreadPane } from "./project/project-thread-pane";
import { ProjectThreadsController } from "./project/project-threads-controller";

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
  const threadController = useMemo(
    () =>
      new ProjectThreadsController({
        client,
        reportError: _reportError,
      }),
    [client]
  );
  const threadState = useSyncExternalStore(
    threadController.subscribe,
    threadController.getSnapshot,
    threadController.getSnapshot
  );
  const { executeCommand } = useCommands();
  const [sourceFiles, setSourceFiles] = useState<readonly ProjectSourceNode[]>(
    []
  );
  const [expandedSourceIds, setExpandedSourceIds] = useState<readonly string[]>(
    []
  );
  const [tabs, setTabs] = useState<readonly ProjectTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeThreadId = threadState.activeThread?.id;
  const openingThreadId = threadState.openingThreadId;
  const visibleThread =
    activeTab?.type === "thread" &&
    activeThreadId === activeTab.threadId
      ? threadState.activeThread
      : undefined;
  const openingThread =
    activeTab?.type === "thread" &&
    openingThreadId === activeTab.threadId;

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

  const openThread = useCallback(
    async (threadId: string) => {
      const thread = await threadController.open(threadId);
      if (thread !== undefined) openThreadTab(thread);
    },
    [openThreadTab, threadController]
  );

  const createThread = useCallback(async () => {
    const thread = await threadController.create();
    if (thread !== undefined) openThreadTab(thread);
  }, [openThreadTab, threadController]);

  const forkThread = useCallback(
    async (threadId: string, entryId?: string) => {
      const thread = await threadController.fork(threadId, entryId);
      if (thread !== undefined) openThreadTab(thread);
    },
    [openThreadTab, threadController]
  );

  useRegisterCommands({
    "project.createThread": createThread,
    "project.forkThread": ({ threadId, checkpointId }) =>
      forkThread(threadId, checkpointId),
  });

  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    if (
      tab?.type === "thread" &&
      activeThreadId !== tab.threadId &&
      openingThreadId !== tab.threadId
    ) {
      void openThread(tab.threadId);
    }
  }, [activeTabId, activeThreadId, openThread, openingThreadId, tabs]);

  useEffect(() => {
    const thread = threadState.activeThread;
    if (thread === undefined) return;
    setTabs((current) => {
      const id = `thread:${thread.id}`;
      const title = thread.document.title;
      if (current.find((tab) => tab.id === id)?.title === title) return current;
      return current.map((tab) => (tab.id === id ? { ...tab, title } : tab));
    });
  }, [threadState.activeThread]);

  useEffect(() => {
    let cancelled = false;
    void threadController.start().then((thread) => {
      if (!cancelled && thread !== undefined) openThreadTab(thread);
    });
    return () => {
      cancelled = true;
      threadController.stop();
    };
  }, [openThreadTab, threadController]);

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
    void client
      .listSourceFiles()
      .then((files) => {
        if (!cancelled) setSourceFiles(files);
      })
      .catch((error: unknown) => {
        toast.error("Unable to load Project source", {
          description: _errorMessage(error),
        });
      });
    return () => {
      cancelled = true;
      sourceController.abort();
    };
  }, [client]);

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
            {threadState.threads.length === 0 ? (
              <div className="text-muted-foreground px-2 py-3 text-xs">
                No Studio Threads
              </div>
            ) : (
              threadState.threads.map((thread) => (
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
                {threadState.loading || openingThread
                  ? openingThread
                    ? "Opening Thread…"
                    : "Opening Project…"
                  : threadState.openError === undefined
                    ? "No Studio Threads yet"
                    : "This Thread cannot be opened"}
              </EmptyTitle>
              <EmptyDescription>
                {threadState.openError ??
                  "Create an independent Studio Thread for this Agent."}
              </EmptyDescription>
            </EmptyHeader>
            {!threadState.loading && (
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
          <ProjectThreadPane
            client={client}
            controller={threadController}
            projectId={project.id}
            history={threadState.runHistory.get(visibleThread.id) ?? []}
            evaluationMetadata={
              threadState.evaluationMetadata.get(visibleThread.id) ?? {
                evaluations: [],
                rubrics: [],
              }
            }
            thread={visibleThread}
          />
        )}
      </main>
    </div>
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

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function _reportError(title: string, error: unknown): void {
  toast.error(title, { description: _errorMessage(error) });
}
