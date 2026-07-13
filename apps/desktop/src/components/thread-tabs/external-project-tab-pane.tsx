import type { Thread } from "@llm-space/core";
import {
  AlertTriangleIcon,
  BotIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { externalAgentProjects } from "@/client";
import { useCommands, useRegisterCommands } from "@/commands";
import { CodeEditor } from "@/components/code-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ThreadPlayground } from "@/components/thread-playground";
import { Button } from "@/components/ui/button";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import {
  getExternalAgentProjectRunBlockReason,
  hasPendingExternalAgentProjectToolResult,
  type ExternalAgentProjectRunBlockReason,
  type ExternalAgentProjectThreadRecord,
  type ExternalAgentProjectView,
} from "@/shared/external-agent-project";

function _ExternalProjectTabPane({
  projectId,
  threadId,
  active,
  refreshNonce,
}: {
  projectId: string;
  threadId?: string;
  active: boolean;
  refreshNonce: number;
}) {
  return (
    <section className={cn("absolute inset-0", !active && "hidden")}>
      {threadId ? (
        <_ProjectThreadPane
          projectId={projectId}
          threadId={threadId}
          active={active}
          refreshNonce={refreshNonce}
        />
      ) : (
        <_ProjectBuildPane
          projectId={projectId}
          active={active}
          refreshNonce={refreshNonce}
        />
      )}
    </section>
  );
}

function _ProjectThreadPane({
  projectId,
  threadId,
  active,
  refreshNonce,
}: {
  projectId: string;
  threadId: string;
  active: boolean;
  refreshNonce: number;
}) {
  const [project, setProject] = useState<ExternalAgentProjectView | null>(null);
  const [record, setRecord] = useState<ExternalAgentProjectThreadRecord | null>(
    null
  );
  const [externalUpdate, setExternalUpdate] = useState<{
    revision: number;
    update: (thread: Thread) => Thread;
  }>();
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const { executeCommand } = useCommands();
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ExternalAgentProjectThreadRecord | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;

  const flush = useCallback(async () => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) {
      await externalAgentProjects.writeThread(projectId, threadId, next);
    }
  }, [projectId, threadId]);

  const load = useCallback(async () => {
    await flush();
    try {
      const [nextProject, nextRecord] = await Promise.all([
        externalAgentProjects.inspect(projectId),
        externalAgentProjects.readThread(projectId, threadId),
      ]);
      setProject(nextProject);
      if (
        recordRef.current &&
        JSON.stringify(recordRef.current.thread) !==
          JSON.stringify(nextRecord.thread)
      ) {
        setExternalUpdate((current) => ({
          revision: (current?.revision ?? 0) + 1,
          update: (thread) => ({
            ...thread,
            context: {
              ...thread.context,
              tools: nextRecord.thread.context?.tools,
            },
          }),
        }));
      }
      setRecord(nextRecord);
    } catch (error) {
      toast.error("Unable to open project Thread", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [flush, projectId, threadId]);

  useEffect(() => {
    void load();
    return () => {
      void flush();
    };
  }, [load, flush, refreshNonce]);

  const refreshProject = useCallback(
    async (runEnded = false) => {
      const nextProject = await externalAgentProjects.inspect(projectId);
      setProject(nextProject);
      const current = pending.current ?? recordRef.current;
      if (!current) return;
      const enabledToolNames = new Set(
        (current.thread.context?.tools ?? [])
          .filter((tool) => tool.type === "project")
          .map((tool) => tool.name)
      );
      const tools = nextProject.tools.filter((tool) =>
        enabledToolNames.has(tool.name)
      );
      const toolsChanged =
        JSON.stringify(tools) !==
        JSON.stringify(current.thread.context?.tools ?? []);
      const title = nextProject.threads.find(
        (thread) => thread.id === threadId
      )?.title;
      const awaitingToolResult =
        hasPendingExternalAgentProjectToolResult(current);
      if ((running && !runEnded) || awaitingToolResult) {
        if (title && title !== current.thread.title) {
          setRecord({
            ...current,
            thread: { ...current.thread, title },
          });
        }
        return;
      }
      if (!toolsChanged && (!title || title === current.thread.title)) return;
      setRecord({
        ...current,
        thread: {
          ...current.thread,
          ...(title ? { title } : {}),
          context: { ...current.thread.context, tools },
        },
      });
      if (toolsChanged) {
        setExternalUpdate((update) => ({
          revision: (update?.revision ?? 0) + 1,
          update: (thread) => ({
            ...thread,
            context: { ...thread.context, tools },
          }),
        }));
      }
    },
    [projectId, running, threadId]
  );

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) return;
    const listener = ({ projectId: changed }: { projectId: string }) => {
      if (changed === projectId) void refreshProject();
    };
    rpc.addMessageListener("externalAgentProjectChanged", listener);
    return () =>
      rpc.removeMessageListener("externalAgentProjectChanged", listener);
  }, [projectId, refreshProject]);

  const handleChange = useCallback(
    (thread: Thread) => {
      const current = recordRef.current;
      if (!current) return;
      const next = { ...current, thread };
      setRecord(next);
      pending.current = next;
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => void flush(), 500);
    },
    [flush]
  );

  const handleRename = useCallback(
    async (title: string) => {
      const current = recordRef.current;
      if (!current) return false;
      const next = { ...current, thread: { ...current.thread, title } };
      setRecord(next);
      pending.current = next;
      await flush();
      return true;
    },
    [flush]
  );

  const syncPrompt = useCallback(async () => {
    await flush();
    const next = await externalAgentProjects.syncThreadPrompt(
      projectId,
      threadId
    );
    setRecord(next);
    setExternalUpdate((current) => ({
      revision: (current?.revision ?? 0) + 1,
      update: (thread) => ({
        ...thread,
        context: {
          ...thread.context,
          systemPrompt: next.thread.context?.systemPrompt,
        },
      }),
    }));
  }, [flush, projectId, threadId]);

  const enableAllTools = useCallback(async () => {
    if (!project || !recordRef.current) return;
    const next = {
      ...recordRef.current,
      thread: {
        ...recordRef.current.thread,
        context: {
          ...recordRef.current.thread.context,
          tools: project.tools,
        },
      },
    };
    await externalAgentProjects.writeThread(projectId, threadId, next);
    setRecord(next);
    setExternalUpdate((current) => ({
      revision: (current?.revision ?? 0) + 1,
      update: (thread) => ({
        ...thread,
        context: { ...thread.context, tools: project.tools },
      }),
    }));
  }, [project, projectId, threadId]);
  useRegisterCommands(
    {
      syncExternalAgentProjectPrompt: ({
        projectId: commandProjectId,
        threadId: commandThreadId,
      }) => {
        if (
          commandProjectId === projectId &&
          commandThreadId === threadId &&
          !running
        ) {
          return syncPrompt();
        }
      },
      enableExternalAgentProjectTools: ({
        projectId: commandProjectId,
        threadId: commandThreadId,
      }) => {
        if (
          commandProjectId === projectId &&
          commandThreadId === threadId &&
          !running
        ) {
          return enableAllTools();
        }
      },
    },
    active
  );
  const loadPromptSkills = useCallback(
    () => Promise.resolve(project?.skills ?? []),
    [project?.skills]
  );
  const handleStreamingStart = useCallback(() => setRunning(true), []);
  const handleStreamingEnd = useCallback(() => {
    setRunning(false);
    queueMicrotask(() => void refreshProject(true));
  }, [refreshProject]);

  const awaitingToolResult = record
    ? hasPendingExternalAgentProjectToolResult(record)
    : false;
  const runBlockReason: ExternalAgentProjectRunBlockReason | null =
    project && record
      ? getExternalAgentProjectRunBlockReason(project, record)
      : "sourceUnavailable";
  useEffect(() => {
    if (runBlockReason === "staleToolSnapshot") {
      void refreshProject();
    }
  }, [refreshProject, runBlockReason]);

  if (!project || !record) {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
        Loading project Thread…
      </div>
    );
  }
  if (project.status !== "ready" && !running && !awaitingToolResult) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangleIcon className="text-destructive size-7" />
        <h2 className="font-medium">Invalid Agent Project</h2>
        <p className="text-muted-foreground max-w-xl text-sm whitespace-pre-wrap">
          {project.error}
        </p>
        <Button
          onClick={() =>
            executeCommand({
              type: "refreshExternalAgentProject",
              args: { projectId },
            })
          }
        >
          <RefreshCwIcon /> Refresh
        </Button>
      </div>
    );
  }

  const promptLocallyChanged =
    (record.thread.context?.systemPrompt ?? "") !== record.syncedPrompt;
  const promptOutOfSync =
    record.promptFingerprint !== project.promptFingerprint ||
    promptLocallyChanged;
  const enabledProjectTools = (record.thread.context?.tools ?? []).filter(
    (tool) => tool.type === "project"
  ).length;
  return (
    <>
      <ThreadPlayground
        className="bg-background size-full"
        path={`project/${projectId}/${threadId}.json`}
        title={record.thread.title ?? "untitled"}
        initialValue={record.thread}
        externalUpdate={externalUpdate}
        runDisabled={runBlockReason !== null}
        active={active}
        onStreamingStart={handleStreamingStart}
        onStreamingEnd={handleStreamingEnd}
        onChange={handleChange}
        onRenameTitle={handleRename}
        loadPromptSkills={loadPromptSkills}
        headerDetails={
          <div className="flex min-w-0 items-center gap-2 text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1 truncate">
              <BotIcon className="size-3" /> {project.name} ·{" "}
              {project.status === "ready"
                ? "Watching"
                : "Source invalid; current run is frozen"}
            </span>
            {promptOutOfSync ? (
              <Button
                className="h-5 px-1.5 text-[10px]"
                size="sm"
                variant="outline"
                disabled={running || project.status !== "ready"}
                onClick={() =>
                  promptLocallyChanged
                    ? setSyncConfirmOpen(true)
                    : executeCommand({
                        type: "syncExternalAgentProjectPrompt",
                        args: { projectId, threadId },
                      })
                }
              >
                <RefreshCwIcon className="size-3" /> Sync from Project
              </Button>
            ) : null}
            {enabledProjectTools < project.tools.length ? (
              <Button
                className="h-5 px-1.5 text-[10px]"
                size="sm"
                variant="outline"
                disabled={running || project.status !== "ready"}
                onClick={() =>
                  executeCommand({
                    type: "enableExternalAgentProjectTools",
                    args: { projectId, threadId },
                  })
                }
              >
                <WrenchIcon className="size-3" /> Enable all project tools
              </Button>
            ) : null}
          </div>
        }
      />
      <ConfirmDialog
        open={syncConfirmOpen}
        onOpenChange={setSyncConfirmOpen}
        title="Sync prompt from project?"
        description="This replaces this Thread’s system prompt with the latest project prompt. You can undo the change after syncing."
        confirmLabel="Sync from Project"
        onConfirm={() => {
          setSyncConfirmOpen(false);
          executeCommand({
            type: "syncExternalAgentProjectPrompt",
            args: { projectId, threadId },
          });
        }}
      />
    </>
  );
}

function _ProjectBuildPane({
  projectId,
  active,
  refreshNonce,
}: {
  projectId: string;
  active: boolean;
  refreshNonce: number;
}) {
  const [project, setProject] = useState<ExternalAgentProjectView | null>(null);
  const [selectedFile, setSelectedFile] = useState("instructions.md");
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const { executeCommand } = useCommands();

  const loadProject = useCallback(async () => {
    const next = await externalAgentProjects.inspect(projectId);
    setProject(next);
    if (!next.sourceFiles.includes(selectedFile)) {
      setSelectedFile(next.sourceFiles[0] ?? "instructions.md");
    }
  }, [projectId, selectedFile]);

  const loadSource = useCallback(async () => {
    try {
      const result = await externalAgentProjects.readSource(
        projectId,
        selectedFile
      );
      setText(result.text);
      setSavedText(result.text);
    } catch (error) {
      toast.error("Unable to read Agent source", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [projectId, selectedFile]);

  useEffect(() => {
    void loadProject();
  }, [loadProject, refreshNonce]);
  useEffect(() => {
    void loadSource();
  }, [loadSource]);

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) return;
    const listener = ({ projectId: changed }: { projectId: string }) => {
      if (changed === projectId) void loadProject();
    };
    rpc.addMessageListener("externalAgentProjectChanged", listener);
    return () =>
      rpc.removeMessageListener("externalAgentProjectChanged", listener);
  }, [loadProject, projectId]);

  useRegisterCommands(
    {
      saveExternalAgentProjectSource: async ({
        projectId: commandProjectId,
        path,
        text: nextText,
      }) => {
        if (commandProjectId !== projectId) return;
        await externalAgentProjects.writeSource(projectId, path, nextText);
        setSavedText(nextText);
      },
    },
    active
  );

  if (!project) return null;
  return (
    <div className="flex size-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <BotIcon className="text-primary size-4" />
        <span className="text-sm font-medium">{project.name}</span>
        <span className="rounded border px-1.5 py-0.5 text-[10px]">
          External Agent Project
        </span>
        <span
          className={cn(
            "ml-auto text-xs",
            project.status === "ready"
              ? "text-muted-foreground"
              : "text-destructive"
          )}
        >
          {project.status === "ready" ? "Watching" : project.status}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={text === savedText}
          onClick={() =>
            executeCommand({
              type: "saveExternalAgentProjectSource",
              args: { projectId, path: selectedFile, text },
            })
          }
        >
          Save
        </Button>
      </header>
      {project.error ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive border-b px-3 py-2 text-xs whitespace-pre-wrap">
          {project.error}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r p-2">
          <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wide uppercase">
            Agent source
          </p>
          {project.sourceFiles.map((file) => (
            <button
              key={file}
              type="button"
              className={cn(
                "focus-visible:ring-ring/30 w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs outline-none focus-visible:ring-2",
                file === selectedFile
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              )}
              onClick={() => setSelectedFile(file)}
            >
              {file}
            </button>
          ))}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="h-9 shrink-0 border-b px-3 py-2 font-mono text-xs">
            {selectedFile}
          </div>
          <CodeEditor
            className="min-h-0 flex-1"
            value={text}
            onChange={setText}
          />
        </main>
      </div>
    </div>
  );
}

export const ExternalProjectTabPane = memo(_ExternalProjectTabPane);
