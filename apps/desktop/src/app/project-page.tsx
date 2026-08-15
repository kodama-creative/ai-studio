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
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import { createProjectSourceClient } from "@/client/project-source-client";
import { createStudioClient } from "@/client/studio-client";
import { useCommands, useRegisterCommands } from "@/commands";
import { TreeView, type TreeDataItem } from "@/components/tree-view";
import type { AgentProjectView } from "@/shared/agent-project";
import type { ProjectSourceNode } from "@/shared/project-source-rpc";

import { ProjectThreadPane } from "./project/project-thread-pane";
import { ProjectWorkspaceController } from "./project/project-workspace-controller";

export function ProjectPage({ project }: { project: AgentProjectView }) {
  const studioClient = useMemo(() => createStudioClient(), []);
  const sourceClient = useMemo(() => createProjectSourceClient(), []);
  const workspace = useMemo(
    () =>
      new ProjectWorkspaceController({
        studioClient,
        sourceClient,
        reportError: _reportError,
      }),
    [sourceClient, studioClient]
  );
  const workspaceState = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot
  );
  const threadState = workspaceState.threads;
  const sourceState = workspaceState.source;
  const { executeCommand } = useCommands();
  const [expandedSourceIds, setExpandedSourceIds] = useState<readonly string[]>(
    []
  );
  const tabs = workspaceState.tabs;
  const activeTabId = workspaceState.activeTabId;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeThreadId = threadState.activeThread?.id;
  const openingThreadId = threadState.openingThreadId;
  const visibleThread =
    activeTab?.type === "thread" && activeThreadId === activeTab.threadId
      ? threadState.activeThread
      : undefined;
  const openingThread =
    activeTab?.type === "thread" && openingThreadId === activeTab.threadId;

  useRegisterCommands({
    "project.createThread": workspace.createThread,
    "project.forkThread": ({ threadId, checkpointId }) =>
      workspace.forkThread(threadId, checkpointId),
  });

  useEffect(() => {
    workspace.start();
    return () => {
      workspace.stop();
    };
  }, [workspace]);

  const sourceTree = useMemo<TreeDataItem[]>(
    () =>
      _sourceTreeItems(
        sourceState.files,
        (path) => void workspace.openSourceFile(path),
        (path) =>
          setExpandedSourceIds((current) => {
            const id = `source:${path}`;
            return current.includes(id)
              ? current.filter((item) => item !== id)
              : [...current, id];
          })
      ),
    [sourceState.files, workspace]
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
                  onClick={() => void workspace.openThread(thread.id)}
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
                onClick={() => workspace.selectTab(tab.id)}
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
                    workspace.closeTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                      workspace.closeTab(tab.id);
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
              value={sourceState.contentByPath.get(activeTab.path) ?? ""}
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
            client={studioClient}
            projectId={project.id}
            history={threadState.runHistory.get(visibleThread.id) ?? []}
            evaluationMetadata={
              threadState.evaluationMetadata.get(visibleThread.id) ?? {
                evaluations: [],
                rubrics: [],
              }
            }
            thread={visibleThread}
            onThreadProjection={workspace.acceptThreadProjection}
            onRunSettled={workspace.refreshThreads}
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
