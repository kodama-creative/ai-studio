import type { Thread, ThreadAgentRuntimeProvenance } from "@llm-space/core";
import { agentModelMatchesDefinition } from "@llm-space/runtime";
import {
  AlertTriangleIcon,
  BotIcon,
  RefreshCwIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createRpcTransport, externalAgentProjects } from "@/client";
import { useCommands, useRegisterCommands } from "@/commands";
import {
  CodeEditor,
  type CodeEditorHandle,
  type CodeEditorLanguage,
} from "@/components/code-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useModels } from "@/components/model-provider";
import { ThreadPlayground } from "@/components/thread-playground";
import {
  getAutoRunTools,
  getReactLoop,
} from "@/components/thread-playground/stores/run-mode";
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

import { registerTabCloseGuard, setTabDirty } from "./tab-close-guards";

function _ExternalProjectTabPane({
  tabId,
  projectId,
  threadId,
  active,
  refreshNonce,
}: {
  tabId: string;
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
          tabId={tabId}
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
  const providers = useModels();
  const { executeCommand } = useCommands();
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ExternalAgentProjectThreadRecord | null>(null);
  const recordRef = useRef(record);
  const activeRunProvenance = useRef<ThreadAgentRuntimeProvenance | null>(null);
  recordRef.current = record;
  const runtimeTransport = useMemo(
    () =>
      createRpcTransport({
        runtime: () => ({
          type: "agentProject",
          projectId,
          threadId,
          modelSource:
            recordRef.current?.thread.agentRuntime?.modelSource ??
            "threadOverride",
          executionMode: getReactLoop()
            ? "react"
            : getAutoRunTools()
              ? "autoOnce"
              : "manual",
        }),
        onRuntimeResolved: (runtime) => {
          activeRunProvenance.current = runtime;
        },
      }),
    [projectId, threadId]
  );

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
        if (!running || runEnded) setProject(nextProject);
        return;
      }
      setProject(nextProject);
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
      const modelChanged = !_sameRuntimeModel(
        current.thread.model,
        thread.model
      );
      const nextThread = modelChanged
        ? {
            ...thread,
            agentRuntime: {
              projectId,
              snapshot:
                thread.agentRuntime?.snapshot ?? project?.snapshot ?? "",
              definitionFingerprint:
                thread.agentRuntime?.definitionFingerprint ??
                project?.definitionFingerprint ??
                "",
              modelSource: "threadOverride" as const,
            },
          }
        : thread;
      const next = { ...current, thread: nextThread };
      setRecord(next);
      pending.current = next;
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => void flush(), 500);
    },
    [flush, project, projectId]
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

  const syncFromAgent = useCallback(async () => {
    await flush();
    const next = await externalAgentProjects.syncThreadFromAgent(
      projectId,
      threadId
    );
    setRecord(next);
    setExternalUpdate((current) => ({
      revision: (current?.revision ?? 0) + 1,
      update: (thread) => ({
        ...thread,
        model: next.thread.model,
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
      syncExternalAgentProjectThreadFromAgent: ({
        projectId: commandProjectId,
        threadId: commandThreadId,
      }) => {
        if (
          commandProjectId === projectId &&
          commandThreadId === threadId &&
          !running
        ) {
          return syncFromAgent();
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
  const prepareRunSnapshot = useCallback(
    (thread: Thread): Thread => {
      const frozen = activeRunProvenance.current ?? {
        projectId,
        snapshot: project?.snapshot ?? "",
        definitionFingerprint: project?.definitionFingerprint ?? "",
        modelSource:
          recordRef.current?.thread.agentRuntime?.modelSource ??
          (agentModelMatchesDefinition({
            model: thread.model,
            reasoning: thread.model?.params?.reasoning,
            definition: project?.definition,
          })
            ? "agent"
            : "threadOverride"),
      };
      return {
        ...thread,
        agentRuntime: {
          projectId: frozen.projectId,
          snapshot: frozen.snapshot,
          definitionFingerprint: frozen.definitionFingerprint,
          modelSource: frozen.modelSource,
        },
      };
    },
    [project, projectId]
  );
  const handleStreamingStart = useCallback(() => {
    activeRunProvenance.current = project
      ? {
          projectId,
          snapshot: project.snapshot,
          definitionFingerprint: project.definitionFingerprint,
          modelSource:
            recordRef.current?.thread.agentRuntime?.modelSource ??
            (recordRef.current &&
            agentModelMatchesDefinition({
              model: recordRef.current.thread.model,
              reasoning: recordRef.current.thread.model?.params?.reasoning,
              definition: project.definition,
            })
              ? "agent"
              : "threadOverride"),
        }
      : null;
    setRunning(true);
  }, [project, projectId]);
  const handleStreamingEnd = useCallback(() => {
    setRunning(false);
    queueMicrotask(() => {
      activeRunProvenance.current = null;
      void refreshProject(true);
    });
  }, [refreshProject]);

  const awaitingToolResult = record
    ? hasPendingExternalAgentProjectToolResult(record)
    : false;
  const runBlockReason: ExternalAgentProjectRunBlockReason | null =
    project && record
      ? getExternalAgentProjectRunBlockReason(project, record)
      : "sourceUnavailable";
  const savedModelAvailable = useMemo(() => {
    const model = record?.thread.model;
    if (!model) return false;
    const provider = providers.find(
      (candidate) => candidate.id === model.provider
    );
    return Boolean(
      provider &&
      !provider.disabledModels?.includes(model.id) &&
      provider.models.some((candidate) => candidate.id === model.id)
    );
  }, [providers, record?.thread.model]);
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
  const currentReasoning = record.thread.model?.params?.reasoning;
  const modelValueChanged =
    record.thread.model?.provider !== record.syncedDefinition.model.provider ||
    record.thread.model?.id !== record.syncedDefinition.model.id;
  const reasoningValueChanged =
    currentReasoning !== record.syncedDefinition.reasoning;
  const provenanceOnlyModelOverride =
    record.thread.agentRuntime?.modelSource === "threadOverride" &&
    !modelValueChanged &&
    !reasoningValueChanged;
  const modelLocallyChanged = modelValueChanged || provenanceOnlyModelOverride;
  const reasoningLocallyChanged = reasoningValueChanged;
  const definitionLocallyChanged =
    modelLocallyChanged || reasoningLocallyChanged;
  const locallyChanged = promptLocallyChanged || definitionLocallyChanged;
  const agentOutOfSync =
    record.promptFingerprint !== project.promptFingerprint ||
    record.definitionFingerprint !== project.definitionFingerprint ||
    locallyChanged;
  const replacedFields = [
    ...(promptLocallyChanged ? ["instructions"] : []),
    ...(modelLocallyChanged ? ["model"] : []),
    ...(reasoningLocallyChanged ? ["reasoning"] : []),
  ];
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
        runDisabled={runBlockReason !== null || !savedModelAvailable}
        active={active}
        transport={runtimeTransport}
        runtimeOwnsToolLoop
        preserveSavedModel
        prepareRunSnapshot={prepareRunSnapshot}
        onStreamingStart={handleStreamingStart}
        onStreamingEnd={handleStreamingEnd}
        onChange={handleChange}
        onRenameTitle={handleRename}
        loadPromptSkills={loadPromptSkills}
        headerDetails={
          <div className="flex min-w-0 items-center gap-2 text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1 truncate">
              <BotIcon className="size-3" /> {project.name}
              {project.status === "ready"
                ? null
                : " · Source invalid; current run is frozen"}
            </span>
            <span className="text-muted-foreground shrink-0">
              {locallyChanged ? "Thread override" : "From Agent"}
            </span>
            {!savedModelAvailable ? (
              <span className="text-destructive flex shrink-0 items-center gap-1">
                <AlertTriangleIcon className="size-3" /> Model unavailable
              </span>
            ) : null}
            {agentOutOfSync ? (
              <Button
                className="h-5 px-1.5 text-[10px]"
                size="sm"
                variant="outline"
                disabled={running || project.status !== "ready"}
                onClick={() =>
                  locallyChanged
                    ? setSyncConfirmOpen(true)
                    : executeCommand({
                        type: "syncExternalAgentProjectThreadFromAgent",
                        args: { projectId, threadId },
                      })
                }
              >
                <RefreshCwIcon className="size-3" /> Sync from Agent
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
        title="Sync settings from Agent?"
        description={`This replaces this Thread’s ${replacedFields.join(", ")} with the latest Agent values. You can undo the change after syncing.`}
        confirmLabel="Sync from Agent"
        onConfirm={() => {
          setSyncConfirmOpen(false);
          executeCommand({
            type: "syncExternalAgentProjectThreadFromAgent",
            args: { projectId, threadId },
          });
        }}
      />
    </>
  );
}

function _ProjectBuildPane({
  tabId,
  projectId,
  active,
  refreshNonce,
}: {
  tabId: string;
  projectId: string;
  active: boolean;
  refreshNonce: number;
}) {
  const [project, setProject] = useState<ExternalAgentProjectView | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Map<string, SourceBuffer>>(new Map());
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [closeResolver, setCloseResolver] = useState<
    ((allow: boolean) => void) | null
  >(null);
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const draftsRef = useRef(new Map<string, string>());
  const editorRef = useRef<CodeEditorHandle>(null);
  const initializedRef = useRef(false);
  const { executeCommand } = useCommands();
  const updateBuffer = useCallback(
    (path: string, update: (buffer: SourceBuffer) => SourceBuffer) => {
      setBuffers((current) => {
        const buffer = current.get(path);
        if (!buffer) return current;
        const nextBuffer = update(buffer);
        if (nextBuffer === buffer) return current;
        const next = new Map(current);
        next.set(path, nextBuffer);
        return next;
      });
    },
    []
  );

  const openSource = useCallback(
    async (path: string) => {
      setOpenFiles((current) =>
        current.includes(path) ? current : [...current, path]
      );
      setActiveFile(path);
      if (buffersRef.current.has(path)) return;
      setBuffers((current) => {
        if (current.has(path)) return current;
        const next = new Map(current);
        next.set(path, {
          path,
          text: "",
          savedText: "",
          diskText: "",
          dirty: false,
          conflict: false,
          loading: true,
          revision: 0,
        });
        return next;
      });
      try {
        const { text } = await externalAgentProjects.readSource(
          projectId,
          path
        );
        draftsRef.current.set(path, text);
        updateBuffer(path, (buffer) => ({
          ...buffer,
          text,
          savedText: text,
          diskText: text,
          loading: false,
        }));
      } catch (error) {
        updateBuffer(path, (buffer) => ({
          ...buffer,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        toast.error("Unable to read Agent source", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [projectId, updateBuffer]
  );

  const loadProject = useCallback(async () => {
    const next = await externalAgentProjects.inspect(projectId);
    setProject(next);
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (next.sourceFiles.includes("instructions.md")) {
        void openSource("instructions.md");
      }
    }
    const paths = openFilesRef.current.filter((path) =>
      next.sourceFiles.includes(path)
    );
    await Promise.all(
      paths.map(async (path) => {
        const { text: diskText } = await externalAgentProjects.readSource(
          projectId,
          path
        );
        const buffer = buffersRef.current.get(path);
        if (!buffer || buffer.loading) return;
        const draft = draftsRef.current.get(path) ?? buffer.text;
        if (buffer.dirty) {
          if (diskText !== buffer.diskText) {
            updateBuffer(path, (current) => ({
              ...current,
              diskText,
              conflict: true,
            }));
          }
        } else if (diskText !== buffer.diskText) {
          draftsRef.current.set(path, diskText);
          updateBuffer(path, (current) => ({
            ...current,
            text: diskText,
            savedText: diskText,
            diskText,
            dirty: false,
            conflict: false,
            error: undefined,
            revision: current.revision + 1,
          }));
        } else if (draft !== buffer.text) {
          draftsRef.current.set(path, buffer.text);
        }
      })
    );
  }, [openSource, projectId, updateBuffer]);

  useEffect(() => {
    void loadProject();
  }, [loadProject, refreshNonce]);

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

  const hasDirtyBuffers = [...buffers.values()].some((buffer) => buffer.dirty);
  useEffect(() => {
    setTabDirty(tabId, hasDirtyBuffers);
  }, [hasDirtyBuffers, tabId]);

  const discardAll = useCallback(() => {
    setBuffers((current) => {
      const next = new Map(current);
      for (const [path, buffer] of current) {
        if (!buffer.dirty && !buffer.conflict) continue;
        draftsRef.current.set(path, buffer.diskText);
        next.set(path, {
          ...buffer,
          text: buffer.diskText,
          savedText: buffer.diskText,
          dirty: false,
          conflict: false,
          error: undefined,
          revision: buffer.revision + 1,
        });
      }
      return next;
    });
  }, []);

  useEffect(
    () =>
      registerTabCloseGuard(tabId, () => {
        if (![...buffersRef.current.values()].some((buffer) => buffer.dirty)) {
          return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) =>
          setCloseResolver(() => resolve)
        );
      }),
    [tabId]
  );

  const saveSource = useCallback(
    async (path: string, nextText: string, overwrite = false) => {
      const buffer = buffersRef.current.get(path);
      if (!buffer || (buffer.conflict && !overwrite)) return;
      try {
        await externalAgentProjects.writeSource(projectId, path, nextText);
        draftsRef.current.set(path, nextText);
        updateBuffer(path, (current) => ({
          ...current,
          text: nextText,
          savedText: nextText,
          diskText: nextText,
          dirty: false,
          conflict: false,
          error: undefined,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateBuffer(path, (current) => ({ ...current, error: message }));
        toast.error("Unable to save Agent source", { description: message });
      }
    },
    [projectId, updateBuffer]
  );

  useRegisterCommands(
    {
      saveExternalAgentProjectSource: async ({
        projectId: commandProjectId,
        path,
        text: nextText,
        overwrite,
      }) => {
        if (commandProjectId !== projectId) return;
        await saveSource(path, nextText, overwrite);
      },
    },
    active
  );

  const closeSource = useCallback((path: string) => {
    const current = openFilesRef.current;
    const index = current.indexOf(path);
    if (index === -1) return;
    const next = current.filter((candidate) => candidate !== path);
    setOpenFiles(next);
    setActiveFile((activePath) =>
      activePath === path
        ? (next[index] ?? next[index - 1] ?? null)
        : activePath
    );
    draftsRef.current.delete(path);
    setBuffers((currentBuffers) => {
      const nextBuffers = new Map(currentBuffers);
      nextBuffers.delete(path);
      return nextBuffers;
    });
  }, []);

  const requestCloseSource = useCallback(
    (path: string) => {
      if (buffersRef.current.get(path)?.dirty) setPendingClose(path);
      else closeSource(path);
    },
    [closeSource]
  );

  const activeBuffer = activeFile ? buffers.get(activeFile) : undefined;
  const activeText = activeFile
    ? (draftsRef.current.get(activeFile) ?? activeBuffer?.text ?? "")
    : "";

  if (!project) return null;
  return (
    <div
      className="flex size-full min-h-0 flex-col"
      data-agent-build={projectId}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <BotIcon className="text-primary size-4" />
        <span className="text-sm font-medium">{project.name}</span>
        {project.status === "ready" ? null : (
          <span className="text-destructive ml-auto text-xs">
            {project.status}
          </span>
        )}
        <Button
          className={cn(project.status === "ready" && "ml-auto")}
          size="sm"
          variant="outline"
          disabled={
            !activeFile || !activeBuffer?.dirty || activeBuffer.conflict
          }
          onClick={() => {
            if (activeFile) {
              executeCommand({
                type: "saveExternalAgentProjectSource",
                args: {
                  projectId,
                  path: activeFile,
                  text: editorRef.current?.getValue() ?? activeText,
                },
              });
            }
          }}
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
              title={file}
              className={cn(
                "focus-visible:ring-ring/30 w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs outline-none focus-visible:ring-2",
                file === activeFile
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              )}
              onClick={() => void openSource(file)}
            >
              {file}
            </button>
          ))}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          {openFiles.length > 0 ? (
            <div
              className="flex h-9 shrink-0 overflow-x-auto border-b"
              role="tablist"
              aria-label="Open Agent source files"
            >
              {openFiles.map((file) => {
                const buffer = buffers.get(file);
                return (
                  <div
                    key={file}
                    className={cn(
                      "group flex shrink-0 items-center border-r",
                      file === activeFile && "bg-muted"
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={file === activeFile}
                      className="flex h-full items-center gap-1.5 px-3 font-mono text-xs"
                      title={file}
                      onClick={() => setActiveFile(file)}
                    >
                      <span>{file}</span>
                      {buffer?.dirty ? (
                        <span
                          className="text-primary"
                          aria-label="Unsaved changes"
                        >
                          ●
                        </span>
                      ) : null}
                    </button>
                    <Button
                      className="mr-1 size-5 opacity-70 group-hover:opacity-100"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Close ${file}`}
                      onClick={() => requestCloseSource(file)}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}
          {activeFile && activeBuffer ? (
            <>
              {activeBuffer.conflict ? (
                <div className="border-warning/40 bg-warning/5 flex items-center gap-2 border-b px-3 py-2 text-xs">
                  <span className="mr-auto">Changed on disk</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      draftsRef.current.set(activeFile, activeBuffer.diskText);
                      updateBuffer(activeFile, (buffer) => ({
                        ...buffer,
                        text: buffer.diskText,
                        savedText: buffer.diskText,
                        dirty: false,
                        conflict: false,
                        error: undefined,
                        revision: buffer.revision + 1,
                      }));
                    }}
                  >
                    Reload from disk
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      executeCommand({
                        type: "saveExternalAgentProjectSource",
                        args: {
                          projectId,
                          path: activeFile,
                          text: editorRef.current?.getValue() ?? activeText,
                          overwrite: true,
                        },
                      })
                    }
                  >
                    Overwrite
                  </Button>
                </div>
              ) : null}
              {activeBuffer.error ? (
                <div className="border-destructive/40 bg-destructive/5 text-destructive border-b px-3 py-2 text-xs">
                  {activeBuffer.error}
                </div>
              ) : null}
              {activeBuffer.loading ? (
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                  Loading source…
                </div>
              ) : (
                <CodeEditor
                  key={`${activeFile}:${activeBuffer.revision}`}
                  ref={editorRef}
                  className="min-h-0 flex-1 rounded-none border-0"
                  language={_sourceLanguage(activeFile)}
                  value={activeText}
                  onDraftChange={(next) => {
                    draftsRef.current.set(activeFile, next);
                    updateBuffer(activeFile, (buffer) => {
                      const dirty = next !== buffer.savedText;
                      return dirty === buffer.dirty
                        ? buffer
                        : { ...buffer, dirty };
                    });
                  }}
                  onChange={(next) => {
                    draftsRef.current.set(activeFile, next);
                    updateBuffer(activeFile, (buffer) => ({
                      ...buffer,
                      text: next,
                      dirty: next !== buffer.savedText,
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key.toLowerCase() === "s" &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      executeCommand({
                        type: "saveExternalAgentProjectSource",
                        args: {
                          projectId,
                          path: activeFile,
                          text: editorRef.current?.getValue() ?? activeText,
                        },
                      });
                    }
                  }}
                />
              )}
            </>
          ) : (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
              Select an Agent source file to edit.
            </div>
          )}
        </main>
      </div>
      <ConfirmDialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
        title={`Discard changes to ${pendingClose ?? "source"}?`}
        description="Your unsaved changes will be lost."
        confirmLabel="Discard changes"
        onConfirm={() => {
          const path = pendingClose;
          setPendingClose(null);
          if (path) closeSource(path);
        }}
      />
      <ConfirmDialog
        open={closeResolver !== null}
        onOpenChange={(open) => {
          if (!open && closeResolver) {
            const resolve = closeResolver;
            setCloseResolver(null);
            resolve(false);
          }
        }}
        title="Discard unsaved Agent source changes?"
        description="One or more open source files have unsaved changes."
        confirmLabel="Discard changes"
        onConfirm={() => {
          const resolve = closeResolver;
          discardAll();
          setCloseResolver(null);
          resolve?.(true);
        }}
      />
    </div>
  );
}

interface SourceBuffer {
  path: string;
  text: string;
  savedText: string;
  diskText: string;
  dirty: boolean;
  conflict: boolean;
  loading: boolean;
  revision: number;
  error?: string;
}

function _sourceLanguage(path: string): CodeEditorLanguage {
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  return "markdown";
}

function _sameRuntimeModel(
  left: Thread["model"],
  right: Thread["model"]
): boolean {
  return (
    left?.provider === right?.provider &&
    left?.id === right?.id &&
    left?.params?.reasoning === right?.params?.reasoning
  );
}

export const ExternalProjectTabPane = memo(_ExternalProjectTabPane);
